use napi_derive::napi;
use serde::Serialize;

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
