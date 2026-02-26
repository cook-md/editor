use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;

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
