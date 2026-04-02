use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;

// ── Sync globals ─────────────────────────────────────────────────────────────

/// Shared state that tracks the current sync status, updated by the listener.
struct SyncStatusState {
    status: String,
    last_error: Option<String>,
    last_synced: Option<String>,
}

impl Default for SyncStatusState {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            last_error: None,
            last_synced: None,
        }
    }
}

impl SyncStatusState {
    /// Serialize current state to a JSON string for the JS callback.
    fn to_json(&self) -> String {
        serde_json::json!({
            "status": self.status,
            "lastError": self.last_error,
            "lastSynced": self.last_synced,
        })
        .to_string()
    }
}

/// Global JS callback invoked on every status change from the sync client.
static SYNC_STATUS_CALLBACK: std::sync::Mutex<Option<ThreadsafeFunction<String, ErrorStrategy::Fatal>>> =
    std::sync::Mutex::new(None);

/// Notify the registered JS callback (if any) with the current state.
fn notify_js_callback(state: &SyncStatusState) {
    let cb = SYNC_STATUS_CALLBACK.lock().unwrap();
    if let Some(ref tsfn) = *cb {
        tsfn.call(state.to_json(), ThreadsafeFunctionCallMode::NonBlocking);
    }
}

/// Listener that receives callbacks from `cooklang-sync-client` and updates
/// the shared `SyncStatusState`, then notifies the JS callback.
struct NapiSyncStatusListener {
    state: Arc<std::sync::Mutex<SyncStatusState>>,
}

impl cooklang_sync_client::SyncStatusListener for NapiSyncStatusListener {
    fn on_status_changed(&self, status: cooklang_sync_client::SyncStatus) {
        let mut state = self.state.lock().unwrap();
        match status {
            cooklang_sync_client::SyncStatus::Idle => {
                state.status = "idle".to_string();
            }
            cooklang_sync_client::SyncStatus::Syncing => {
                state.status = "syncing".to_string();
            }
            cooklang_sync_client::SyncStatus::Indexing => {
                state.status = "indexing".to_string();
            }
            cooklang_sync_client::SyncStatus::Downloading => {
                state.status = "downloading".to_string();
            }
            cooklang_sync_client::SyncStatus::Uploading => {
                state.status = "uploading".to_string();
            }
            cooklang_sync_client::SyncStatus::Error { message } => {
                state.status = "error".to_string();
                state.last_error = Some(message);
            }
        }
        notify_js_callback(&state);
    }

    fn on_complete(&self, success: bool, message: Option<String>) {
        let mut state = self.state.lock().unwrap();
        if success {
            state.status = "idle".to_string();
            state.last_error = None;
            state.last_synced = Some(chrono::Utc::now().to_rfc3339());
        } else {
            state.status = "error".to_string();
            state.last_error = Some(message.unwrap_or_else(|| "Sync failed".to_string()));
        }
        notify_js_callback(&state);
    }
}

/// Global sync context so we can cancel a running sync from `stop_sync`.
static SYNC_CONTEXT: std::sync::Mutex<Option<Arc<cooklang_sync_client::SyncContext>>> =
    std::sync::Mutex::new(None);

/// Global shared status state so `get_sync_status` can read the latest values.
static SYNC_STATUS_STATE: std::sync::OnceLock<Arc<std::sync::Mutex<SyncStatusState>>> =
    std::sync::OnceLock::new();

fn get_sync_status_state() -> Arc<std::sync::Mutex<SyncStatusState>> {
    SYNC_STATUS_STATE
        .get_or_init(|| Arc::new(std::sync::Mutex::new(SyncStatusState::default())))
        .clone()
}

#[derive(Serialize)]
pub struct ParseResult {
    pub recipe: Option<serde_json::Value>,
    pub errors: Vec<DiagnosticInfo>,
    pub warnings: Vec<DiagnosticInfo>,
}

#[derive(Serialize)]
pub struct DiagnosticInfo {
    pub message: String,
    pub severity: String,
}

/// Parse a Cooklang recipe text and return the parsed result as JSON.
#[napi]
pub fn parse(input: String) -> napi::Result<String> {
    let parser = cooklang::CooklangParser::new(
        cooklang::Extensions::all(),
        Default::default(),
    );

    let result = parser.parse(&input);
    let report = result.report();

    let errors: Vec<DiagnosticInfo> = report
        .errors()
        .map(|e| DiagnosticInfo {
            message: e.message.to_string(),
            severity: "error".to_string(),
        })
        .collect();

    let warnings: Vec<DiagnosticInfo> = report
        .warnings()
        .map(|w| DiagnosticInfo {
            message: w.message.to_string(),
            severity: "warning".to_string(),
        })
        .collect();

    let recipe = result.output().map(|r| {
        serde_json::to_value(r).unwrap_or(serde_json::Value::Null)
    });

    let parse_result = ParseResult {
        recipe,
        errors,
        warnings,
    };

    serde_json::to_string(&parse_result)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Input for a single recipe when generating a shopping list.
#[derive(Deserialize)]
pub struct RecipeInput {
    pub content: String,
    pub scale: f64,
}

/// A single ingredient line in a shopping list category.
#[derive(Serialize)]
pub struct ShoppingListItem {
    pub name: String,
    pub quantities: String,
}

/// A named category (aisle) containing shopping list items.
#[derive(Serialize)]
pub struct ShoppingListCategory {
    pub name: String,
    pub items: Vec<ShoppingListItem>,
}

/// The result returned by `generate_shopping_list`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShoppingListResult {
    /// Ingredients grouped by aisle category (empty when no aisle config is given).
    pub categories: Vec<ShoppingListCategory>,
    /// Ingredients that did not match any aisle category, or all ingredients when
    /// no aisle config is given.
    pub other: ShoppingListCategory,
    /// Names of ingredients found in the pantry (subtracted from the list).
    pub pantry_items: Vec<String>,
}

/// Convert an `IngredientList` into a `ShoppingListCategory` with the given name.
fn ingredient_list_to_category(
    name: String,
    list: cooklang::ingredient_list::IngredientList,
) -> ShoppingListCategory {
    let items = list
        .into_iter()
        .map(|(ingredient_name, quantity)| ShoppingListItem {
            name: ingredient_name,
            quantities: quantity.to_string(),
        })
        .collect();
    ShoppingListCategory { name, items }
}

/// Generate a shopping list from one or more Cooklang recipes.
///
/// - `recipes_json` – JSON array of `{ content: string, scale: number }` objects.
/// - `aisle_conf` – optional aisle configuration text (cooklang shopping-list format).
/// - `pantry_conf` – optional pantry configuration text (TOML format).
///
/// Returns a JSON-serialized `ShoppingListResult`.
#[napi]
pub fn generate_shopping_list(
    recipes_json: String,
    aisle_conf: Option<String>,
    pantry_conf: Option<String>,
) -> napi::Result<String> {
    let recipe_inputs: Vec<RecipeInput> = serde_json::from_str(&recipes_json)
        .map_err(|e| napi::Error::from_reason(format!("Failed to parse recipes JSON: {e}")))?;

    let parser = cooklang::CooklangParser::new(
        cooklang::Extensions::all(),
        Default::default(),
    );
    let converter = parser.converter();

    // Parse each recipe, scale it, and accumulate into the ingredient list.
    let mut ingredient_list = cooklang::ingredient_list::IngredientList::new();
    for input in recipe_inputs {
        let mut recipe = match parser.parse(&input.content).into_output() {
            Some(r) => r,
            None => continue,
        };
        if (input.scale - 1.0).abs() > f64::EPSILON {
            recipe.scale(input.scale, converter);
        }
        ingredient_list.add_recipe(&recipe, converter, false);
    }

    // Parse optional aisle configuration.
    let aisle = aisle_conf
        .as_deref()
        .map(cooklang::aisle::parse_lenient)
        .and_then(|pass| pass.into_output());

    // Normalise ingredient names to common names when aisle config is available.
    if let Some(ref a) = aisle {
        ingredient_list = ingredient_list.use_common_names(a, converter);
    }

    // Parse optional pantry configuration and collect the names of subtracted items.
    let mut pantry_item_names: Vec<String> = Vec::new();
    if let Some(ref pantry_text) = pantry_conf {
        let pantry = cooklang::pantry::parse_lenient(pantry_text).into_output();
        if let Some(ref p) = pantry {
            // Record which ingredients are covered by the pantry before subtracting.
            for (name, _) in ingredient_list.iter() {
                if p.has_ingredient(name) {
                    pantry_item_names.push(name.clone());
                }
            }
            ingredient_list = ingredient_list.subtract_pantry(p, converter);
        }
    }

    // Categorise by aisle (or leave everything in "other").
    let result = if let Some(ref a) = aisle {
        let categorized = ingredient_list.categorize(a);
        let categories: Vec<ShoppingListCategory> = categorized
            .categories
            .into_iter()
            .map(|(name, list)| ingredient_list_to_category(name, list))
            .collect();
        let other = ingredient_list_to_category("other".to_string(), categorized.other);
        ShoppingListResult {
            categories,
            other,
            pantry_items: pantry_item_names,
        }
    } else {
        // No aisle config – put everything in "other".
        let other = ingredient_list_to_category("other".to_string(), ingredient_list);
        ShoppingListResult {
            categories: Vec::new(),
            other,
            pantry_items: pantry_item_names,
        }
    };

    serde_json::to_string(&result)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

// ── Menu parsing ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct MenuParseResult {
    pub metadata: Option<MenuMetadata>,
    pub sections: Vec<MenuSection>,
    pub errors: Vec<DiagnosticInfo>,
    pub warnings: Vec<DiagnosticInfo>,
}

#[derive(Serialize)]
pub struct MenuMetadata {
    pub servings: Option<String>,
    pub time: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub source: Option<String>,
    #[serde(rename = "sourceUrl")]
    pub source_url: Option<String>,
    pub custom: Vec<(String, String)>,
}

#[derive(Serialize)]
pub struct MenuSection {
    pub name: Option<String>,
    pub lines: Vec<Vec<MenuSectionItem>>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum MenuSectionItem {
    #[serde(rename = "text")]
    Text { value: String },
    #[serde(rename = "recipeReference")]
    RecipeReference {
        name: String,
        scale: Option<f64>,
    },
    #[serde(rename = "ingredient")]
    Ingredient {
        name: String,
        quantity: Option<String>,
        unit: Option<String>,
    },
}

/// Format a cooklang `Value` into a human-readable string for quantities.
fn format_menu_value(value: &cooklang::Value) -> Option<String> {
    match value {
        cooklang::Value::Number(n) => {
            let v = n.value();
            if v == v.floor() {
                Some(format!("{}", v as i64))
            } else {
                Some(format!("{}", v))
            }
        }
        cooklang::Value::Range { start, end } => {
            let s = start.value();
            let e = end.value();
            Some(format!("{}-{}", s, e))
        }
        cooklang::Value::Text(t) => Some(t.to_string()),
    }
}

/// Parse a Cooklang menu file and return a menu-specific JSON structure.
#[napi]
pub fn parse_menu(input: String, scale: f64) -> napi::Result<String> {
    let parser = cooklang::CooklangParser::new(
        cooklang::Extensions::all(),
        Default::default(),
    );

    let result = parser.parse(&input);
    let report = result.report();

    let errors: Vec<DiagnosticInfo> = report
        .errors()
        .map(|e| DiagnosticInfo {
            message: e.message.to_string(),
            severity: "error".to_string(),
        })
        .collect();

    let warnings: Vec<DiagnosticInfo> = report
        .warnings()
        .map(|w| DiagnosticInfo {
            message: w.message.to_string(),
            severity: "warning".to_string(),
        })
        .collect();

    let recipe = match result.into_output() {
        Some(r) => r,
        None => {
            let menu_result = MenuParseResult {
                metadata: None,
                sections: Vec::new(),
                errors,
                warnings,
            };
            return serde_json::to_string(&menu_result)
                .map_err(|e| napi::Error::from_reason(e.to_string()));
        }
    };

    // Build sections from recipe content
    let mut sections: Vec<MenuSection> = Vec::new();

    for section in &recipe.sections {
        let section_name = section.name.clone();
        let mut lines: Vec<Vec<MenuSectionItem>> = Vec::new();

        for content in &section.content {
            if let cooklang::Content::Step(step) = content {
                let mut step_items: Vec<MenuSectionItem> = Vec::new();
                let mut current_text = String::new();

                for item in &step.items {
                    match item {
                        cooklang::Item::Text { value } => {
                            if value == "-" {
                                // Bullet marker — finalise current line and start a new one
                                if !current_text.is_empty() {
                                    step_items.push(MenuSectionItem::Text {
                                        value: current_text.clone(),
                                    });
                                    current_text.clear();
                                }
                                if !step_items.is_empty() {
                                    lines.push(step_items.clone());
                                    step_items.clear();
                                }
                            } else {
                                // Split on newlines; each newline flushes the current line
                                let parts: Vec<&str> = value.split('\n').collect();
                                for (i, part) in parts.iter().enumerate() {
                                    if i > 0 {
                                        if !current_text.is_empty() {
                                            step_items.push(MenuSectionItem::Text {
                                                value: current_text.clone(),
                                            });
                                            current_text.clear();
                                        }
                                        if !step_items.is_empty() {
                                            lines.push(step_items.clone());
                                            step_items.clear();
                                        }
                                    }
                                    if !part.is_empty() {
                                        current_text.push_str(part);
                                    }
                                }
                            }
                        }
                        cooklang::Item::Ingredient { index } => {
                            // Flush any accumulated text first
                            if !current_text.is_empty() {
                                step_items.push(MenuSectionItem::Text {
                                    value: current_text.clone(),
                                });
                                current_text.clear();
                            }

                            if let Some(ing) = recipe.ingredients.get(*index) {
                                if let Some(ref recipe_ref) = ing.reference {
                                    // Recipe reference — extract numeric scale from quantity
                                    let recipe_scale =
                                        ing.quantity.as_ref().and_then(|q| {
                                            match q.value() {
                                                cooklang::Value::Number(n) => Some(n.value()),
                                                _ => None,
                                            }
                                        });

                                    // Apply menu scaling to the recipe reference scale
                                    let final_scale = recipe_scale.map(|s| s * scale);

                                    let name = if recipe_ref.components.is_empty() {
                                        recipe_ref.name.clone()
                                    } else {
                                        format!(
                                            "{}/{}",
                                            recipe_ref.components.join("/"),
                                            recipe_ref.name
                                        )
                                    };

                                    step_items.push(MenuSectionItem::RecipeReference {
                                        name,
                                        scale: final_scale,
                                    });
                                } else {
                                    // Regular ingredient
                                    let quantity = ing
                                        .quantity
                                        .as_ref()
                                        .and_then(|q| format_menu_value(q.value()));
                                    let unit = ing
                                        .quantity
                                        .as_ref()
                                        .and_then(|q| q.unit().map(|u| u.to_string()));

                                    step_items.push(MenuSectionItem::Ingredient {
                                        name: ing.name.to_string(),
                                        quantity,
                                        unit,
                                    });
                                }
                            }
                        }
                        // Cookware, timers, and other items are ignored in menu files
                        _ => {}
                    }
                }

                // Flush any remaining text and items as the final line of this step
                if !current_text.is_empty() {
                    step_items.push(MenuSectionItem::Text {
                        value: current_text,
                    });
                }
                if !step_items.is_empty() {
                    lines.push(step_items);
                }
            }
        }

        if !lines.is_empty() {
            sections.push(MenuSection {
                name: section_name,
                lines,
            });
        }
    }

    // Extract metadata
    let metadata = if recipe.metadata.map.is_empty() {
        None
    } else {
        let get_field = |key: &str| -> Option<String> {
            recipe.metadata.get(key).and_then(|v| {
                if let Some(s) = v.as_str() {
                    Some(s.to_string())
                } else if let Some(n) = v.as_i64() {
                    Some(n.to_string())
                } else {
                    v.as_f64().map(|f| {
                        if f == f.floor() {
                            format!("{}", f as i64)
                        } else {
                            format!("{}", f)
                        }
                    })
                }
            })
        };

        let mut custom: Vec<(String, String)> = Vec::new();
        for (key, value) in recipe.metadata.map_filtered() {
            // Skip keys that have dedicated fields above
            if let (Some(key_str), Some(val_str)) = (key.as_str(), value.as_str()) {
                custom.push((key_str.to_string(), val_str.to_string()));
            }
        }

        Some(MenuMetadata {
            servings: get_field("servings").or_else(|| get_field("serves")),
            time: get_field("time").or_else(|| get_field("duration")),
            author: get_field("author"),
            description: get_field("description"),
            source: get_field("source"),
            source_url: get_field("source.url"),
            custom,
        })
    };

    let menu_result = MenuParseResult {
        metadata,
        sections,
        errors,
        warnings,
    };

    serde_json::to_string(&menu_result)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub struct LspServer {
    request_tx: mpsc::UnboundedSender<Vec<u8>>,
    response_rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<Vec<u8>>>>,
    #[allow(dead_code)]
    runtime: Arc<tokio::runtime::Runtime>,
}

#[napi]
impl LspServer {
    #[napi(constructor)]
    pub fn new() -> napi::Result<Self> {
        let runtime = Arc::new(
            tokio::runtime::Runtime::new()
                .map_err(|e| napi::Error::from_reason(e.to_string()))?,
        );

        let (request_tx, mut request_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (response_tx, response_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        runtime.spawn(async move {
            // Create duplex pairs for LSP communication
            // server_read/server_write: the server reads input from server_read and writes output to server_write
            // client_write: we write Node.js messages into this, which the server reads from server_read
            // client_read: we read from this, which contains the server's output written to server_write
            let (client_read, server_write) = tokio::io::duplex(8192);
            let (server_read, mut client_write) = tokio::io::duplex(8192);

            // Forward Node.js messages to the server input
            tokio::spawn(async move {
                use tokio::io::AsyncWriteExt;
                while let Some(msg) = request_rx.recv().await {
                    if client_write.write_all(&msg).await.is_err() {
                        break;
                    }
                    if client_write.flush().await.is_err() {
                        break;
                    }
                }
            });

            // Read server output and forward to Node.js
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut buf = vec![0u8; 65536];
                let mut client_read = client_read;
                loop {
                    match client_read.read(&mut buf).await {
                        Ok(0) => break,
                        Ok(n) => {
                            if response_tx.send(buf[..n].to_vec()).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            });

            // Start the LSP server
            let (service, socket) = tower_lsp::LspService::new(
                cooklang_language_server::Backend::new,
            );
            tower_lsp::Server::new(server_read, server_write, socket)
                .serve(service)
                .await;
        });

        Ok(LspServer {
            request_tx,
            response_rx: Arc::new(tokio::sync::Mutex::new(response_rx)),
            runtime,
        })
    }

    #[napi]
    pub fn send_message(&self, message: String) -> napi::Result<()> {
        self.request_tx
            .send(message.into_bytes())
            .map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    #[napi]
    pub async fn receive_message(&self) -> napi::Result<Option<String>> {
        let mut rx = self.response_rx.lock().await;
        match rx.recv().await {
            Some(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|e| napi::Error::from_reason(e.to_string())),
            None => Ok(None),
        }
    }
}

// ── CookCloud sync ───────────────────────────────────────────────────────────

/// Start a background sync task.
///
/// Creates a `SyncContext`, attaches a status listener, stores the context
/// globally (so `stop_sync` can cancel it), and spawns a tokio task that
/// calls `cooklang_sync_client::run_async`.
#[napi]
pub fn start_sync(
    recipes_dir: String,
    db_path: String,
    sync_endpoint: String,
    jwt: String,
    namespace_id: i32,
) -> napi::Result<()> {
    // Cancel any previous sync before starting a new one.
    let _ = stop_sync();

    let sync_context = cooklang_sync_client::SyncContext::new();

    // Wire up the status listener.
    let shared_state = get_sync_status_state();
    {
        let mut state = shared_state.lock().unwrap();
        state.status = "syncing".to_string();
        state.last_error = None;
    }
    let listener = Arc::new(NapiSyncStatusListener {
        state: shared_state,
    });
    sync_context.set_listener(listener);

    // Store context globally so `stop_sync` can reach it.
    {
        let mut global = SYNC_CONTEXT.lock().unwrap();
        *global = Some(Arc::clone(&sync_context));
    }

    // Spawn the async sync task on the napi tokio runtime.
    tokio::spawn(async move {
        let result = cooklang_sync_client::run_async(
            sync_context,
            &recipes_dir,
            &db_path,
            &sync_endpoint,
            &jwt,
            namespace_id,
            false, // download_only = false → bidirectional sync
        )
        .await;

        if let Err(e) = result {
            let shared_state = get_sync_status_state();
            let mut state = shared_state.lock().unwrap();
            state.status = "error".to_string();
            state.last_error = Some(format!("{:?}", e));
        }

        // Clear the global context when the task finishes.
        let mut global = SYNC_CONTEXT.lock().unwrap();
        *global = None;
    });

    Ok(())
}

/// Cancel a running sync operation.
///
/// Retrieves the global `SyncContext` and calls `cancel()` on it, which
/// triggers cancellation of all child tokens inside the sync client.
#[napi]
pub fn stop_sync() -> napi::Result<()> {
    let global = SYNC_CONTEXT.lock().unwrap();
    if let Some(ref ctx) = *global {
        ctx.cancel();
    }
    Ok(())
}

/// Return the current sync status as a JSON string.
///
/// The returned JSON has the shape:
/// ```json
/// { "status": "idle"|"syncing"|"indexing"|"downloading"|"uploading"|"error",
///   "lastError": "..." | null,
///   "lastSynced": "2025-01-01T00:00:00Z" | null }
/// ```
#[napi]
pub fn get_sync_status() -> napi::Result<String> {
    let shared_state = get_sync_status_state();
    let state = shared_state.lock().unwrap();

    let value = serde_json::json!({
        "status": state.status,
        "lastError": state.last_error,
        "lastSynced": state.last_synced,
    });

    serde_json::to_string(&value)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Register a JS callback that is invoked on every sync status change.
///
/// The callback receives a JSON string with the same shape as `getSyncStatus`.
/// Replaces any previously registered callback.
#[napi]
pub fn on_sync_status_changed(callback: napi::JsFunction) -> napi::Result<()> {
    let tsfn: ThreadsafeFunction<String, ErrorStrategy::Fatal> =
        callback.create_threadsafe_function(0, |ctx: napi::threadsafe_function::ThreadSafeCallContext<String>| {
            Ok(vec![ctx.env.create_string(&ctx.value)?])
        })?;
    let mut cb = SYNC_STATUS_CALLBACK.lock().unwrap();
    *cb = Some(tsfn);
    Ok(())
}
