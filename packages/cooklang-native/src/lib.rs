use napi_derive::napi;
use serde::Serialize;
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
