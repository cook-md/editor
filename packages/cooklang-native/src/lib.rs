// *****************************************************************************
// Copyright (C) 2024-2026 cook.md and contributors
//
// SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-cooklang-theia-linking-exception
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License version 3 as
// published by the Free Software Foundation, with the linking exception
// documented in NOTICE.md.
//
// See LICENSE-AGPL for the full license text.
// *****************************************************************************

use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;

mod shopping_list;

use camino::Utf8PathBuf;

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

/// True when `message` is the stringified form of a sync failure caused by a
/// lapsed/missing sync entitlement (the server's HTTP 402 response), as
/// surfaced by `cooklang_sync_client::SyncError::PaymentRequired`.
///
/// This has to match on text because `SyncStatusListener::on_complete` only
/// gives us a `String` (built with `format!("{:?}", err)` — see `start_sync`
/// below and `cooklang_sync_client::run_async`). Every call site propagates
/// `SyncError::PaymentRequired` unchanged (pinned rev
/// 3464309f8799732f765fc1d99a01a310cbba3df7 fixed `syncer::download_loop`,
/// which used to re-wrap it into `SyncError::Unknown(format!("Check download
/// failed: {e}"))`, losing the variant on the very call that usually hits the
/// server first), so `message` today is just the Debug'd variant name
/// "PaymentRequired".
///
/// The direct forms are matched by *exact* (trimmed) equality, not
/// substring — an unrelated error whose message merely contains
/// "PaymentRequired" (e.g. an `IoError` on a file or folder path literally
/// named that) must not paywall the sync UI. The wrapped-prefix check is
/// kept as a narrow, `.contains`-based fallback for the one known shape a
/// future regression could reintroduce: `Unknown(format!("Check download
/// failed: {e}"))`, which embeds `PaymentRequired`'s `Display` text
/// ("Sync requires a paid plan") after that fixed prefix.
fn is_payment_required_error(message: &str) -> bool {
    const WRAPPED_PREFIX: &str = "Check download failed: Sync requires a paid plan";
    let trimmed = message.trim();
    trimmed == "PaymentRequired" || trimmed == "Sync requires a paid plan" || message.contains(WRAPPED_PREFIX)
}

impl SyncStatusState {
    /// Applies a `SyncStatusListener::on_status_changed` event, mirroring the
    /// mapping `NapiSyncStatusListener` sends to JS. Split out from the trait
    /// impl so it can be unit-tested without going through
    /// `notify_js_callback` (whose `ThreadsafeFunction::call` needs the real
    /// napi runtime and can't link in a plain `cargo test` binary).
    fn apply_status_changed(&mut self, status: cooklang_sync_client::SyncStatus) {
        match status {
            cooklang_sync_client::SyncStatus::Idle => {
                self.status = "idle".to_string();
            }
            cooklang_sync_client::SyncStatus::Syncing => {
                self.status = "syncing".to_string();
            }
            cooklang_sync_client::SyncStatus::Indexing => {
                self.status = "indexing".to_string();
            }
            cooklang_sync_client::SyncStatus::Downloading => {
                self.status = "downloading".to_string();
            }
            cooklang_sync_client::SyncStatus::Uploading => {
                self.status = "uploading".to_string();
            }
            cooklang_sync_client::SyncStatus::Error { message } => {
                if is_payment_required_error(&message) {
                    self.status = "payment_required".to_string();
                    self.last_error = None;
                } else {
                    self.status = "error".to_string();
                    self.last_error = Some(message);
                }
            }
        }
    }

    /// Applies a `SyncStatusListener::on_complete` event. See
    /// `apply_status_changed` for why this is a plain method rather than
    /// living directly in the trait impl.
    fn apply_complete(&mut self, success: bool, message: Option<String>) {
        if success {
            self.status = "idle".to_string();
            self.last_error = None;
            self.last_synced = Some(chrono::Utc::now().to_rfc3339());
        } else {
            let message = message.unwrap_or_else(|| "Sync failed".to_string());
            if is_payment_required_error(&message) {
                self.status = "payment_required".to_string();
                self.last_error = None;
            } else {
                self.status = "error".to_string();
                self.last_error = Some(message);
            }
        }
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
        state.apply_status_changed(status);
        notify_js_callback(&state);
    }

    fn on_complete(&self, success: bool, message: Option<String>) {
        let mut state = self.state.lock().unwrap();
        state.apply_complete(success, message);
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
    #[serde(rename = "yield")]
    pub yield_: Option<String>,
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
        unit: Option<String>,
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

                                    let recipe_unit = ing
                                        .quantity
                                        .as_ref()
                                        .and_then(|q| q.unit().map(|u| u.to_string()));

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
                                        unit: recipe_unit,
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
            yield_: get_field("yield"),
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
            // `run_async` already reported this failure via the listener's
            // `on_complete` (and pushed it to the JS callback) before
            // returning it here. Re-apply the same classification (rather
            // than defaulting to "error") so a payment_required push above
            // isn't immediately clobbered — with no matching JS notification
            // — the next time `getSyncStatus` is polled.
            let shared_state = get_sync_status_state();
            let mut state = shared_state.lock().unwrap();
            state.apply_complete(false, Some(format!("{:?}", e)));
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

// ── Shopping list format (NAPI wrappers) ─────────────────────────────────────
// Thin JSON-bridge wrappers around helpers in `shopping_list` module.
// All functions are stateless; file I/O is performed by the TypeScript caller.

#[napi(js_name = "parseShoppingList")]
pub fn napi_parse_shopping_list(text: String) -> napi::Result<String> {
    let list = shopping_list::parse_list(&text)
        .map_err(|e| napi::Error::from_reason(format!("parse_shopping_list: {e}")))?;
    serde_json::to_string(&list)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "writeShoppingList")]
pub fn napi_write_shopping_list(json: String) -> napi::Result<String> {
    let list: cooklang::shopping_list::ShoppingList = serde_json::from_str(&json)
        .map_err(|e| napi::Error::from_reason(format!("writeShoppingList parse json: {e}")))?;
    shopping_list::write_list(&list)
        .map_err(|e| napi::Error::from_reason(format!("writeShoppingList: {e}")))
}

#[napi(js_name = "parseChecked")]
pub fn napi_parse_checked(text: String) -> napi::Result<String> {
    let entries = shopping_list::parse_checked_log(&text);
    serde_json::to_string(&entries)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi(js_name = "writeCheckEntry")]
pub fn napi_write_check_entry(entry_json: String) -> napi::Result<String> {
    let entry: cooklang::shopping_list::CheckEntry = serde_json::from_str(&entry_json)
        .map_err(|e| napi::Error::from_reason(format!("writeCheckEntry parse json: {e}")))?;
    shopping_list::write_checked_entry(&entry)
        .map_err(|e| napi::Error::from_reason(format!("writeCheckEntry: {e}")))
}

#[napi(js_name = "checkedSet")]
pub fn napi_checked_set(entries_json: String) -> napi::Result<Vec<String>> {
    let entries: Vec<cooklang::shopping_list::CheckEntry> = serde_json::from_str(&entries_json)
        .map_err(|e| napi::Error::from_reason(format!("checkedSet parse json: {e}")))?;
    let set = shopping_list::checked_set_from_log(&entries);
    Ok(set.into_iter().collect())
}

/// Resolve a recipe by name (with or without extension) inside `base_dir` using
/// `cooklang-find`'s lookup rules (tries `.cook` then `.menu` when no extension).
/// Returns the file content, or `null` if no matching file is found.
#[napi(js_name = "findRecipe")]
pub fn napi_find_recipe(base_dir: String, name: String) -> napi::Result<Option<String>> {
    let base = Utf8PathBuf::from(base_dir);
    let recipe_name = Utf8PathBuf::from(name);
    match cooklang_find::get_recipe([base], recipe_name) {
        Ok(entry) => entry
            .content()
            .map(Some)
            .map_err(|e| napi::Error::from_reason(format!("findRecipe read: {e}"))),
        Err(cooklang_find::fetcher::FetchError::InvalidPath(_)) => Ok(None),
        Err(e) => Err(napi::Error::from_reason(format!("findRecipe: {e}"))),
    }
}

/// Resolve a recipe by name (with or without extension) inside `base_dir` using
/// `cooklang-find`'s lookup rules — the same rules `findRecipe` uses to read the
/// content, so a reference that renders in the preview resolves to the very file
/// the preview read. Returns the absolute path, or `null` if nothing matches.
///
/// Callers must not reconstruct this path themselves: `cooklang-find` decides the
/// search order, which extensions to try (`.cook` then `.menu`) and how a bare
/// name maps onto the tree, and those rules are not reproducible from a name.
#[napi(js_name = "findRecipePath")]
pub fn napi_find_recipe_path(base_dir: String, name: String) -> napi::Result<Option<String>> {
    let base = Utf8PathBuf::from(base_dir);
    let recipe_name = Utf8PathBuf::from(name);
    match cooklang_find::get_recipe([base], recipe_name) {
        Ok(entry) => Ok(entry.path().map(|path| path.to_string())),
        Err(cooklang_find::fetcher::FetchError::InvalidPath(_)) => Ok(None),
        Err(e) => Err(napi::Error::from_reason(format!("findRecipePath: {e}"))),
    }
}

/// Title and step images for the recipe at `recipe_path`, discovered with
/// `cooklang-find`'s naming rules (the same ones CookCLI's web server uses).
///
/// Returns JSON `{ "title": string | null, "steps": { section: { step: path } } }`.
/// `title` is the raw value from metadata (which may be a URL or a relative path)
/// or an absolute path to a sibling file. `steps` keys are zero-indexed, with
/// section 0 holding the linear `Recipe.N.ext` form.
#[napi(js_name = "recipeImages")]
pub fn napi_recipe_images(recipe_path: String) -> napi::Result<String> {
    let path = Utf8PathBuf::from(recipe_path);
    let entry = cooklang_find::RecipeEntry::from_path(path)
        .map_err(|e| napi::Error::from_reason(format!("recipeImages: {e}")))?;
    let payload = serde_json::json!({
        "title": entry.title_image(),
        "steps": entry.step_images().images,
    });
    serde_json::to_string(&payload)
        .map_err(|e| napi::Error::from_reason(format!("recipeImages serialize: {e}")))
}

#[napi(js_name = "compactChecked")]
pub fn napi_compact_checked(
    entries_json: String,
    current_ingredients: Vec<String>,
) -> napi::Result<String> {
    let entries: Vec<cooklang::shopping_list::CheckEntry> = serde_json::from_str(&entries_json)
        .map_err(|e| napi::Error::from_reason(format!("compactChecked parse json: {e}")))?;
    let refs: Vec<&str> = current_ingredients.iter().map(|s| s.as_str()).collect();
    let compacted = shopping_list::compact_checked_log(&entries, refs);
    serde_json::to_string(&compacted)
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

// ── Workspace tools (cookbot) ────────────────────────────────────────────────

/// One entry in the `search_recipes` result.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecipeSearchEntry {
    path: String,
    name: Option<String>,
    title: Option<String>,
    tags: Vec<String>,
    is_menu: bool,
    servings: Option<i64>,
}

impl RecipeSearchEntry {
    fn from_entry(entry: &cooklang_find::RecipeEntry) -> Option<Self> {
        let path = entry.path()?;
        Some(Self {
            path: path.to_string(),
            name: path.file_stem().map(str::to_string),
            title: entry.metadata().title().map(str::to_string),
            tags: entry.tags(),
            is_menu: entry.is_menu(),
            servings: entry.metadata().servings(),
        })
    }
}

/// Every `.cook` / `.menu` file under `base`, sorted by path. Files whose
/// content can't be read (e.g. iCloud placeholders) are skipped, mirroring
/// `cooklang_find::build_tree`. Unlike `build_tree` this never keys by recipe
/// title, so same-titled recipes in one folder are all reported.
fn list_all_recipes(base: &Utf8PathBuf) -> Result<Vec<RecipeSearchEntry>, String> {
    if !base.is_dir() {
        return Err(format!("not a directory: {base}"));
    }
    let mut entries = Vec::new();
    for pattern in ["**/*.cook", "**/*.menu"] {
        let paths = glob::glob(base.join(pattern).as_str()).map_err(|e| e.to_string())?;
        for path in paths.flatten() {
            let Ok(path) = Utf8PathBuf::from_path_buf(path) else {
                continue;
            };
            let Ok(entry) = cooklang_find::RecipeEntry::from_path(path) else {
                continue;
            };
            if let Some(entry) = RecipeSearchEntry::from_entry(&entry) {
                entries.push(entry);
            }
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

fn search_recipes_blocking(
    base_dir: String,
    query: String,
) -> Result<Vec<RecipeSearchEntry>, String> {
    let base = Utf8PathBuf::from(base_dir);
    let query = query.trim();
    if query.is_empty() {
        return list_all_recipes(&base);
    }
    let found = cooklang_find::search(&base, query).map_err(|e| e.to_string())?;
    Ok(found
        .iter()
        .filter_map(RecipeSearchEntry::from_entry)
        .collect())
}

/// Search recipes under `base_dir` the way `cook search` does
/// (`cooklang_find::search`: filename + content term scoring over `.cook` and
/// `.menu`). A blank query lists every recipe, sorted by path.
///
/// Filesystem work runs on a blocking thread so the JS event loop is not stalled.
///
/// Returns JSON: `[{ path, name, title, tags, isMenu, servings }]`, best match first.
#[napi(js_name = "searchRecipes")]
pub async fn search_recipes(base_dir: String, query: String) -> napi::Result<String> {
    let entries = tokio::task::spawn_blocking(move || search_recipes_blocking(base_dir, query))
        .await
        .map_err(|e| napi::Error::from_reason(format!("searchRecipes: {e}")))?
        .map_err(|e| napi::Error::from_reason(format!("searchRecipes: {e}")))?;
    serde_json::to_string(&entries).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PantryItemJson {
    name: String,
    quantity: Option<String>,
    bought: Option<String>,
    expire: Option<String>,
    low: Option<String>,
    is_low: bool,
}

impl PantryItemJson {
    fn from_item(item: &cooklang::pantry::PantryItem) -> Self {
        Self {
            name: item.name().to_string(),
            quantity: item.quantity().map(str::to_string),
            bought: item.bought().map(str::to_string),
            expire: item.expire().map(str::to_string),
            low: item.low().map(str::to_string),
            is_low: item.is_low(),
        }
    }
}

fn parse_pantry_conf(text: &str, caller: &str) -> napi::Result<cooklang::pantry::PantryConf> {
    let result = cooklang::pantry::parse_lenient(text);
    let errors: Vec<String> = result
        .report()
        .errors()
        .map(|e| e.message.to_string())
        .collect();
    match result.into_output() {
        Some(conf) => Ok(conf),
        None => Err(napi::Error::from_reason(format!(
            "{caller}: {}",
            if errors.is_empty() {
                "invalid pantry file".to_string()
            } else {
                errors.join("; ")
            }
        ))),
    }
}

/// Parse a `config/pantry.conf` (TOML) and return its sections and items.
///
/// Returns JSON: `{ sections: [{ name, items: [{ name, quantity, bought, expire, low, isLow }] }],
///                  lowStock: [{ name, section, quantity, low }] }`.
#[napi(js_name = "parsePantry")]
pub fn parse_pantry(text: String) -> napi::Result<String> {
    let conf = parse_pantry_conf(&text, "parsePantry")?;
    let mut low_stock = Vec::new();
    let sections: Vec<serde_json::Value> = conf
        .sections
        .iter()
        .map(|(section, items)| {
            let items_json: Vec<PantryItemJson> = items
                .iter()
                .map(|item| {
                    let json = PantryItemJson::from_item(item);
                    if json.is_low {
                        low_stock.push(serde_json::json!({
                            "name": json.name,
                            "section": section,
                            "quantity": json.quantity,
                            "low": json.low,
                        }));
                    }
                    json
                })
                .collect();
            serde_json::json!({ "name": section, "items": items_json })
        })
        .collect();
    serde_json::to_string(&serde_json::json!({ "sections": sections, "lowStock": low_stock }))
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Check which of `names` are in the pantry (case-insensitive, via
/// `PantryConf::find_ingredient`).
///
/// Returns JSON: `[{ name, inStock, section, quantity, isLow }]` in input order.
#[napi(js_name = "checkPantry")]
pub fn check_pantry(text: String, names: Vec<String>) -> napi::Result<String> {
    let conf = parse_pantry_conf(&text, "checkPantry")?;
    let results: Vec<serde_json::Value> = names
        .iter()
        .map(|name| match conf.find_ingredient(name) {
            Some((section, item)) => serde_json::json!({
                "name": name,
                "inStock": true,
                "section": section,
                "quantity": item.quantity(),
                "isLow": item.is_low(),
            }),
            None => serde_json::json!({
                "name": name,
                "inStock": false,
                "section": null,
                "quantity": null,
                "isLow": false,
            }),
        })
        .collect();
    serde_json::to_string(&results).map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Configuration accepted by `render_report`, mirroring cooklang_reports::Config.
/// All path fields are OS filesystem paths (the Theia backend converts URIs
/// before calling into the addon).
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ReportConfig {
    scale: Option<f64>,
    base_path: Option<String>,
    aisle_path: Option<String>,
    pantry_path: Option<String>,
    datastore_path: Option<String>,
    // Consumed only under `cfg(feature = "nutrition")`; always deserialized so
    // the TS layer sends an identical config shape regardless of build features.
    nutrition_api_url: Option<String>,
    nutrition_token: Option<String>,
    // True when the source is a `.menu` plan. Under `nutrition` the plan is
    // expanded (recipe refs -> ingredients) and exposed as `plan.*` template
    // context; the menu source itself is not rendered as a recipe.
    is_menu: Option<bool>,
}

/// Render a Jinja2 report template against a recipe via cooklang-reports
/// (the same engine cookcli's `cook report` uses).
///
/// Returns JSON: `{"output": "..."}` on success or `{"error": "..."}` on failure.
#[napi]
pub fn render_report(recipe: String, template: String, config_json: String) -> String {
    // A malformed config silently degrades to defaults (no base path, no
    // nutrition wiring); log it so a bad config surfaces in the addon's stderr
    // rather than as a confusing downstream "extension not registered" error.
    let cfg: ReportConfig = serde_json::from_str(&config_json).unwrap_or_else(|e| {
        eprintln!("[cooklang-native] invalid report config JSON, using defaults: {e}");
        ReportConfig::default()
    });
    let base_path = cfg.base_path.clone();
    let mut builder = cooklang_reports::config::Config::builder();
    builder.scale(cfg.scale.unwrap_or(1.0));
    if let Some(p) = cfg.base_path {
        builder.base_path(p);
    }
    if let Some(p) = cfg.aisle_path {
        builder.aisle_path(p);
    }
    if let Some(p) = cfg.pantry_path {
        builder.pantry_path(p);
    }
    if let Some(p) = cfg.datastore_path {
        builder.datastore_path(p);
    }
    let config = builder.build();
    #[cfg(feature = "nutrition")]
    let mut config = match cfg.nutrition_api_url {
        Some(url) => {
            let mut client = cookmd_nutrition_client::Client::new(url);
            if let Some(tok) = cfg.nutrition_token.filter(|t| !t.is_empty()) {
                client = client.with_auth_token(tok);
            }
            let ext = cooklang_reports_nutrition::NutritionExtension::new(std::sync::Arc::new(client));
            config.with_extension(ext)
        }
        None => config,
    };
    // `.menu` plans additionally get `plan.*` context (recipe refs expanded
    // into days/meals/ingredients, dangling refs surfaced). The menu source
    // still renders as a recipe, so templates built on the recipe-shaped
    // `ingredients` (e.g. shopping lists via get_ingredient_list) keep
    // working; plan-aware templates check `plan is defined`. Without the
    // nutrition feature the menu renders as a plain recipe, as before.
    #[cfg(feature = "nutrition")]
    if cfg.is_menu == Some(true) {
        let base = base_path.clone().unwrap_or_else(|| ".".to_string());
        let plan = match cooklang_reports_nutrition::plan::build_plan_from_source(
            &recipe,
            std::path::Path::new(&base),
            None,
        ) {
            Ok(p) => p,
            Err(e) => return serde_json::json!({ "error": format!("plan error: {e}") }).to_string(),
        };
        match serde_json::to_value(&plan) {
            Ok(v) => config = config.with_context("plan", v),
            Err(e) => {
                return serde_json::json!({ "error": format!("plan serialize error: {e}") })
                    .to_string();
            }
        }
    }
    #[cfg(not(feature = "nutrition"))]
    let _ = &base_path;
    match cooklang_reports::render_template_with_config(&recipe, &template, &config) {
        Ok(output) => serde_json::json!({ "output": output }).to_string(),
        Err(err) => serde_json::json!({ "error": err.format_with_source() }).to_string(),
    }
}

#[cfg(test)]
mod render_report_tests {
    #[test]
    fn renders_ingredients_template() {
        let recipe = "Mix @eggs{3} with @flour{125%g}.";
        let template = "{% for i in ingredients %}{{ i.name }};{% endfor %}";
        let result = super::render_report(recipe.into(), template.into(), "{}".into());
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        let output = v["output"].as_str().expect("expected output, not error");
        assert!(output.contains("eggs;"), "output was: {output}");
        assert!(output.contains("flour;"), "output was: {output}");
    }

    #[test]
    fn applies_scale_from_config() {
        let recipe = "Mix @eggs{2}.";
        let template = "{{ scale }}";
        let result = super::render_report(recipe.into(), template.into(), r#"{"scale": 2}"#.into());
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["output"].as_str().unwrap(), "2.0");
    }

    #[test]
    fn returns_error_for_bad_template() {
        let result = super::render_report("Mix @eggs{1}.".into(), "{% for %}".into(), "{}".into());
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(!v["error"].as_str().unwrap().is_empty());
    }

    #[test]
    fn returns_json_for_unparsable_recipe() {
        let garbage = "@{unclosed [- broken >> nonsense";
        let result = super::render_report(garbage.into(), "{{ scale }}".into(), "{}".into());
        let v: serde_json::Value = serde_json::from_str(&result).expect("must return valid JSON");
        assert!(v.get("output").is_some() || v.get("error").is_some());
    }
}

#[cfg(test)]
mod nutrition_wiring_tests {
    // A template that calls nutrition_for. When the nutrition feature is OFF the
    // function is unregistered (render errors with "unknown"); when ON the
    // extension is registered and attempts a call to the configured URL.
    const NUTRITION_TEMPLATE: &str =
        "{{ nutrition_for(ingredient='salmon', amount=100, unit='g').kcal }}";
    const RECIPE: &str = "Add @salmon{100%g}.";

    #[cfg(not(feature = "nutrition"))]
    #[test]
    fn feature_off_nutrition_for_is_unregistered() {
        let cfg = r#"{"nutritionApiUrl":"http://127.0.0.1:9"}"#;
        let out = super::render_report(RECIPE.into(), NUTRITION_TEMPLATE.into(), cfg.into());
        assert!(out.contains("\"error\""), "expected an error payload, got: {out}");
        assert!(out.contains("nutrition_for"), "error should mention the unknown function: {out}");
    }

    #[cfg(feature = "nutrition")]
    #[test]
    fn feature_on_registers_extension_and_attempts_call() {
        // Point at a closed port so the call fails fast with a transport error,
        // proving the extension was registered and invoked.
        let cfg = r#"{"nutritionApiUrl":"http://127.0.0.1:9","nutritionToken":"tok"}"#;
        let out = super::render_report(RECIPE.into(), NUTRITION_TEMPLATE.into(), cfg.into());
        assert!(out.contains("\"error\""), "expected an error payload, got: {out}");
        assert!(!out.contains("unknown"), "function should be registered: {out}");
    }
}

#[cfg(test)]
mod workspace_tools_tests {
    use super::*;

    /// Temporary workspace directory, removed on drop (also when a test panics).
    struct TempWs(std::path::PathBuf);

    impl TempWs {
        fn write(&self, rel: &str, content: &str) {
            let path = self.0.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        }

        fn base_dir(&self) -> String {
            self.0.to_string_lossy().to_string()
        }
    }

    impl Drop for TempWs {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    fn temp_workspace() -> TempWs {
        // pid + counter + time: tests run in parallel and the macOS clock is
        // coarse enough for two of them to observe the same nanosecond.
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "cooklang-native-ws-{}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let ws = TempWs(dir);
        ws.write(
            "Dinner/Salmon Bowl.cook",
            "---\ntitle: Salmon Rice Bowl\ntags: [fish, quick]\nservings: 2\n---\nBake @salmon{200%g} and serve on @rice{1%cup}.\n",
        );
        ws.write(
            "Pancakes.cook",
            "---\ntags: breakfast, sweet\n---\nMix @flour{200%g} and @milk{300%ml}.\n",
        );
        ws.write("Week.menu", "= Monday\n@./Pancakes{2}\n");
        ws
    }

    #[test]
    fn find_recipe_path_resolves_a_top_level_recipe_by_bare_name() {
        let ws = temp_workspace();
        let path = napi_find_recipe_path(ws.base_dir(), "Pancakes".to_string()).unwrap();
        assert!(
            path.as_deref().is_some_and(|p| p.ends_with("Pancakes.cook")),
            "expected Pancakes.cook, got {path:?}"
        );
    }

    #[test]
    fn find_recipe_path_resolves_a_recipe_in_a_subdirectory() {
        // The case the preview widgets got wrong by resolving against the
        // workspace root: the reference names a nested recipe.
        let ws = temp_workspace();
        let path = napi_find_recipe_path(ws.base_dir(), "Dinner/Salmon Bowl".to_string()).unwrap();
        assert!(
            path.as_deref()
                .is_some_and(|p| p.ends_with("Dinner/Salmon Bowl.cook")),
            "expected Dinner/Salmon Bowl.cook, got {path:?}"
        );
    }

    #[test]
    fn find_recipe_path_resolves_a_menu_not_just_cook() {
        // A hardcoded `+ '.cook'` in the caller can never reach this file.
        let ws = temp_workspace();
        let path = napi_find_recipe_path(ws.base_dir(), "Week".to_string()).unwrap();
        assert!(
            path.as_deref().is_some_and(|p| p.ends_with("Week.menu")),
            "expected Week.menu, got {path:?}"
        );
    }

    #[test]
    fn find_recipe_path_returns_none_for_a_missing_recipe() {
        let ws = temp_workspace();
        let path = napi_find_recipe_path(ws.base_dir(), "No Such Recipe".to_string()).unwrap();
        assert_eq!(path, None);
    }

    #[test]
    fn find_recipe_path_agrees_with_find_recipe() {
        // The path and the content must come from the same file, or the preview
        // would render one recipe and navigate to another.
        let ws = temp_workspace();
        let path = napi_find_recipe_path(ws.base_dir(), "Pancakes".to_string())
            .unwrap()
            .expect("path");
        let content = napi_find_recipe(ws.base_dir(), "Pancakes".to_string())
            .unwrap()
            .expect("content");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
    }

    fn search(ws: &TempWs, query: &str) -> Vec<serde_json::Value> {
        let json = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(search_recipes(ws.base_dir(), query.to_string()))
            .unwrap();
        serde_json::from_str(&json).unwrap()
    }

    #[test]
    fn search_recipes_ranks_query_matches_and_reports_metadata() {
        let ws = temp_workspace();
        let entries = search(&ws, "salmon");
        assert!(!entries.is_empty());
        let first = &entries[0];
        assert!(first["path"]
            .as_str()
            .unwrap()
            .ends_with("Dinner/Salmon Bowl.cook"));
        assert_eq!(first["name"], "Salmon Bowl");
        assert_eq!(first["title"], "Salmon Rice Bowl");
        assert_eq!(first["tags"], serde_json::json!(["fish", "quick"]));
        assert_eq!(first["isMenu"], false);
        assert_eq!(first["servings"], 2);
        assert!(entries
            .iter()
            .all(|e| !e["path"].as_str().unwrap().ends_with("Pancakes.cook")));
    }

    #[test]
    fn search_recipes_blank_query_lists_everything() {
        let ws = temp_workspace();
        let entries = search(&ws, "   ");
        let paths: Vec<&str> = entries
            .iter()
            .map(|e| e["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths.len(), 3, "{paths:?}");
        assert!(paths.iter().any(|p| p.ends_with("Pancakes.cook")));
        assert!(paths.iter().any(|p| p.ends_with("Week.menu")));
        let menu = entries
            .iter()
            .find(|e| e["path"].as_str().unwrap().ends_with("Week.menu"))
            .unwrap();
        assert_eq!(menu["isMenu"], true);
        assert_eq!(menu["title"], serde_json::Value::Null);
        assert_eq!(menu["name"], "Week");
    }

    #[test]
    fn search_recipes_blank_query_keeps_same_titled_recipes() {
        let ws = temp_workspace();
        ws.write(
            "Dinner/Bowl A.cook",
            "---\ntitle: Bowl\n---\nAdd @rice{1%cup}.\n",
        );
        ws.write(
            "Dinner/Bowl B.cook",
            "---\ntitle: Bowl\n---\nAdd @quinoa{1%cup}.\n",
        );
        let entries = search(&ws, "");
        let paths: Vec<&str> = entries
            .iter()
            .map(|e| e["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths.len(), 5, "{paths:?}");
        assert!(paths.iter().any(|p| p.ends_with("Dinner/Bowl A.cook")));
        assert!(paths.iter().any(|p| p.ends_with("Dinner/Bowl B.cook")));
        let mut sorted = paths.clone();
        sorted.sort();
        assert_eq!(paths, sorted, "listing must be path-sorted");
    }

    #[test]
    fn search_recipes_rejects_missing_directory() {
        let ws = temp_workspace();
        let missing = format!("{}/nope", ws.base_dir());
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(search_recipes(missing, String::new()))
            .unwrap_err();
        assert!(err.reason.starts_with("searchRecipes:"), "{}", err.reason);
    }

    const PANTRY: &str = r#"
[fridge]
milk = { expire = "10.05.2026", quantity = "1%L" }
eggs = "6"

[pantry]
flour = { quantity = "300%g", low = "500%g" }
salt = {}
"#;

    #[test]
    fn parse_pantry_reports_sections_items_and_low_stock() {
        let json = parse_pantry(PANTRY.to_string()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let sections = v["sections"].as_array().unwrap();
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0]["name"], "fridge");
        let milk = &sections[0]["items"][0];
        assert_eq!(milk["name"], "milk");
        assert_eq!(milk["quantity"], "1%L");
        assert_eq!(milk["expire"], "10.05.2026");
        assert_eq!(milk["bought"], serde_json::Value::Null);
        assert_eq!(milk["isLow"], false);
        let flour = &sections[1]["items"][0];
        assert_eq!(flour["low"], "500%g");
        assert_eq!(flour["isLow"], true);
        assert_eq!(
            v["lowStock"],
            serde_json::json!([{ "name": "flour", "section": "pantry", "quantity": "300%g", "low": "500%g" }])
        );
    }

    #[test]
    fn parse_pantry_rejects_invalid_toml() {
        let err = parse_pantry("[fridge\nmilk = ".to_string()).unwrap_err();
        assert!(err.reason.starts_with("parsePantry:"), "{}", err.reason);
    }

    #[test]
    fn check_pantry_error_names_its_caller() {
        let err =
            check_pantry("[fridge\nmilk = ".to_string(), vec!["milk".to_string()]).unwrap_err();
        assert!(err.reason.starts_with("checkPantry:"), "{}", err.reason);
    }

    #[test]
    fn check_pantry_is_case_insensitive_and_reports_misses() {
        let json = check_pantry(
            PANTRY.to_string(),
            vec![
                "Eggs".to_string(),
                "butter".to_string(),
                "flour".to_string(),
            ],
        )
        .unwrap();
        let v: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(
            v[0],
            serde_json::json!({ "name": "Eggs", "inStock": true, "section": "fridge", "quantity": "6", "isLow": false })
        );
        assert_eq!(
            v[1],
            serde_json::json!({ "name": "butter", "inStock": false, "section": null, "quantity": null, "isLow": false })
        );
        assert_eq!(v[2]["inStock"], true);
        assert_eq!(v[2]["isLow"], true);
    }
}

#[cfg(test)]
mod sync_status_tests {
    use super::*;

    #[test]
    fn detects_direct_payment_required_debug_text() {
        // What most call sites produce: SyncError::PaymentRequired propagated
        // unchanged, `format!("{:?}", e)`'d by run_async/start_sync.
        assert!(is_payment_required_error("PaymentRequired"));
    }

    #[test]
    fn detects_payment_required_wrapped_by_download_loop() {
        // `syncer::download_loop` re-wraps any non-Unauthorized error into
        // SyncError::Unknown(format!("Check download failed: {e}")), which
        // loses the variant but keeps PaymentRequired's Display text.
        let wrapped = "Unknown(\"Check download failed: Sync requires a paid plan\")";
        assert!(is_payment_required_error(wrapped));
    }

    #[test]
    fn does_not_flag_unrelated_errors() {
        assert!(!is_payment_required_error("Unauthorized"));
        assert!(!is_payment_required_error(
            "IoErrorGeneric(Os { code: 2, kind: NotFound, message: \"No such file or directory\" })"
        ));
        assert!(!is_payment_required_error("Sync failed"));
    }

    #[test]
    fn does_not_flag_an_io_error_whose_path_merely_contains_the_variant_name() {
        // A recipe folder or file literally named "PaymentRequired" must not
        // paywall an unrelated IO error — only an exact (trimmed) match on
        // the direct forms counts, never a substring match.
        let message = "IoError { path: \"/Users/alex/PaymentRequired/notes.cook\", \
            source: Os { code: 2, kind: NotFound, message: \"No such file or directory\" } }";
        assert!(!is_payment_required_error(message));
    }

    #[test]
    fn detects_exact_display_text() {
        assert!(is_payment_required_error("Sync requires a paid plan"));
    }

    #[test]
    fn does_not_flag_display_text_as_a_mere_substring() {
        // Same tightening as the Debug case: the Display text must match
        // exactly, not just appear somewhere in a longer message.
        assert!(!is_payment_required_error(
            "context: Sync requires a paid plan (retry later)"
        ));
    }

    #[test]
    fn trims_surrounding_whitespace_before_exact_matching() {
        assert!(is_payment_required_error("  PaymentRequired  "));
        assert!(is_payment_required_error("\nSync requires a paid plan\n"));
    }

    // These exercise `SyncStatusState::apply_status_changed`/`apply_complete`
    // directly rather than the `NapiSyncStatusListener` trait methods: the
    // trait methods also call `notify_js_callback`, whose `ThreadsafeFunction`
    // needs real napi runtime symbols that a plain `cargo test` binary (no
    // Node host) can't link. The `apply_*` methods hold 100% of the mapping
    // logic the trait methods delegate to, so this covers the same behavior.

    #[test]
    fn on_complete_maps_payment_required_debug_text_without_generic_error() {
        let mut state = SyncStatusState::default();
        state.apply_complete(false, Some("PaymentRequired".to_string()));
        assert_eq!(state.status, "payment_required");
        assert!(
            state.last_error.is_none(),
            "payment_required must not carry the generic error text"
        );
    }

    #[test]
    fn on_complete_maps_wrapped_payment_required_from_download_loop() {
        let mut state = SyncStatusState::default();
        state.apply_complete(
            false,
            Some("Unknown(\"Check download failed: Sync requires a paid plan\")".to_string()),
        );
        assert_eq!(state.status, "payment_required");
        assert!(state.last_error.is_none());
    }

    #[test]
    fn on_complete_keeps_generic_error_for_other_failures() {
        let mut state = SyncStatusState::default();
        state.apply_complete(false, Some("Unauthorized".to_string()));
        assert_eq!(state.status, "error");
        assert_eq!(state.last_error.as_deref(), Some("Unauthorized"));
    }

    #[test]
    fn on_complete_success_still_marks_idle_and_clears_error() {
        let mut state = SyncStatusState::default();
        state.apply_complete(true, None);
        assert_eq!(state.status, "idle");
        assert!(state.last_error.is_none());
        assert!(state.last_synced.is_some());
    }

    #[test]
    fn on_status_changed_error_variant_also_detects_payment_required() {
        let mut state = SyncStatusState::default();
        state.apply_status_changed(cooklang_sync_client::SyncStatus::Error {
            message: "PaymentRequired".to_string(),
        });
        assert_eq!(state.status, "payment_required");
        assert!(state.last_error.is_none());
    }

    #[test]
    fn on_status_changed_error_variant_keeps_generic_error_message() {
        let mut state = SyncStatusState::default();
        state.apply_status_changed(cooklang_sync_client::SyncStatus::Error {
            message: "boom".to_string(),
        });
        assert_eq!(state.status, "error");
        assert_eq!(state.last_error.as_deref(), Some("boom"));
    }

    #[test]
    fn on_status_changed_non_error_variants_are_unaffected() {
        let mut state = SyncStatusState::default();
        state.apply_status_changed(cooklang_sync_client::SyncStatus::Downloading);
        assert_eq!(state.status, "downloading");
    }
}

#[cfg(test)]
mod recipe_images_tests {
    use super::*;
    use std::fs;

    /// Creates a temp dir with `Recipe.cook` plus the given sibling image files.
    fn fixture(name: &str, images: &[&str]) -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!(
            "cooklang-images-{}-{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let recipe = dir.join("Pancakes.cook");
        fs::write(&recipe, "Crack the @eggs{2}.\nFry it.\n").unwrap();
        for image in images {
            fs::write(dir.join(image), b"fake").unwrap();
        }
        (dir.clone(), recipe.to_string_lossy().to_string())
    }

    #[test]
    fn reports_no_images_when_folder_has_none() {
        let (_dir, path) = fixture("none", &[]);
        let json = napi_recipe_images(path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value["title"].is_null());
        assert_eq!(value["steps"].as_object().unwrap().len(), 0);
    }

    #[test]
    fn finds_the_sibling_title_image() {
        let (_dir, path) = fixture("title", &["Pancakes.jpg"]);
        let json = napi_recipe_images(path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value["title"].as_str().unwrap().ends_with("Pancakes.jpg"));
    }

    #[test]
    fn finds_a_title_image_for_every_supported_extension() {
        for ext in ["jpg", "jpeg", "png", "webp"] {
            let (_dir, path) = fixture(ext, &[&format!("Pancakes.{ext}")]);
            let json = napi_recipe_images(path).unwrap();
            let value: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert!(
                value["title"]
                    .as_str()
                    .unwrap_or_default()
                    .ends_with(&format!("Pancakes.{ext}")),
                "extension {ext} was not discovered"
            );
        }
    }

    // `Recipe.N.ext` is the linear form: step N across all sections, stored at [0][N-1].
    #[test]
    fn stores_linear_step_images_under_section_zero() {
        let (_dir, path) = fixture("linear", &["Pancakes.1.jpg", "Pancakes.3.png"]);
        let json = napi_recipe_images(path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value["steps"]["0"]["0"].as_str().unwrap().ends_with("Pancakes.1.jpg"));
        assert!(value["steps"]["0"]["2"].as_str().unwrap().ends_with("Pancakes.3.png"));
    }

    // `Recipe.S.N.ext` is the sectioned form: section S step N, stored at [S-1][N-1].
    #[test]
    fn stores_section_step_images_under_the_section_index() {
        let (_dir, path) = fixture("sectioned", &["Pancakes.2.4.jpg"]);
        let json = napi_recipe_images(path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value["steps"]["1"]["3"].as_str().unwrap().ends_with("Pancakes.2.4.jpg"));
    }

    #[test]
    fn errors_when_the_recipe_does_not_exist() {
        assert!(napi_recipe_images("/definitely/not/here/Nope.cook".to_string()).is_err());
    }
}
