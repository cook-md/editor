# Recipe Hub — Federation API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `recipes.cooklang.org` the API the Recipe Hub editor plugin needs: structured filters and `sort` on `GET /api/search`, richer result cards, a cached `GET /api/facets`, tags that are actually searchable for every recipe source, a per-client rate-limit key, and matching docs plus website filters (spec §1.1–1.5 and the federation bullet of §4).

**Architecture:** Filters are a plain `SearchFilters` value (`src/indexer/filters.rs`). `SearchIndex::search_with` turns it into Tantivy clauses ANDed onto the parsed `q`, the same way `locale` works today. The HTTP layer parses string query params into it with `FilterParams` (`src/api/filters.rs`), and the API and the website share that parser. Card fields are stored in the Tantivy document, so a hit needs no DB lookup. Everything a document needs from other tables (tags, ingredients, file path, feed title) is loaded by `IndexExtras::load`. `reindex_recipes` is the single path the GitHub indexer, the crawler and the CLI use to write documents. Facets come from SQL and sit behind a 5-minute in-memory cache in `AppState`.

**Tech Stack:** Rust 2021, axum 0.7, tantivy 0.22.1, sqlx 0.8 (SQLite), askama 0.12, tower_governor 0.4.3, tokio, mockito/tempfile for tests.

**Repository:** every path and command below is relative to `/Users/alexeydubovskoy/Cooklang/federation` unless it is absolute. Run all commands from that directory.

**Baseline (checked 2026-09-25):** on `main` at `29ab812`, `cargo test` passes: 110 lib unit tests plus all integration suites, no failures.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/indexer/schema.rs` | Modify | Add `feed_id`, `indexed_at`, `image_url`, `feed_title`; make `servings`/`total_time` `INDEXED`. |
| `src/indexer/filters.rs` | Create | `SearchFilters`, `SortOrder`, `normalize_difficulty`: the filter model, with no HTTP or Tantivy types. |
| `src/indexer/extras.rs` | Create | `IndexExtras` (non-`recipes` inputs of a document), `IndexExtras::load`, `reindex_recipes` (load + locked write + commit). |
| `src/indexer/search.rs` | Modify | `index_recipe_full`, card fields on `SearchResult`, `search_with` (filters + sort), `LockedWriter` writer gate. Delete the no-op `add_recipe_tags` / `add_recipe_ingredients`. |
| `src/indexer/mod.rs` | Modify | Declare `extras`, `filters`. |
| `src/api/filters.rs` | Create | `FilterParams`: string query params → `(SearchFilters, SortOrder)` with 400s for bad input, plus `query_pairs` for links. |
| `src/api/facets.rs` | Create | `language_facets` (shared with the website dropdown), `load_facets`, `FacetsCache`, `parse_tag_limit`. |
| `src/api/rate_limit.rs` | Create | `client_ip` key logic, `ClientIpKeyExtractor`, `governor_period`. |
| `src/api/mod.rs` | Modify | Declare the three new modules. |
| `src/api/models.rs` | Modify | `SearchParams` flattens `FilterParams`; `RecipeCard` gains card fields and `CardFeed`; facet response models. |
| `src/api/handlers.rs` | Modify | `search_recipes` uses filters and sort; new `get_facets`; `AppState.facets_cache`. |
| `src/api/routes.rs` | Modify | `/api/facets` route; new key extractor and correct governor period; HTTP tests. |
| `src/db/tags.rs` | Modify | `top_tags(pool, limit)`. |
| `src/db/recipes.rs` | Modify | `list_difficulties(pool)`. |
| `src/github/indexer.rs` | Modify | Index through `reindex_recipes`; use `locked_writer` for deletions. |
| `src/cli/commands.rs` | Modify | `backfill_locales` / `cleanup_recipes` index with `IndexExtras::load` (the rebuild path populates feed titles). |
| `src/crawler/mod.rs` | Modify | The crawler (re)indexes the recipes it creates or updates, with their tags. |
| `src/main.rs` | Modify | Share the search index with the crawler; add `AppState.facets_cache`; `into_make_service_with_connect_info`; banner lists `/api/facets`. |
| `src/web/handlers.rs` | Modify | Search page parses the same filters, echoes them into the form, uses `language_facets`. |
| `src/web/templates/search.html` | Modify | Collapsible Filters panel; pagination keeps filters. |
| `src/web/templates/about.html` | Modify | API docs rewritten to match the real endpoints and shapes. |
| `README.md` | Modify | API section, upgrade/reindex release notes. |
| `tests/search_index_tags_test.rs` | Create | Tag regression, writer gate, and rebuild (backfill) populating tags and feed titles. |
| `tests/github_indexer_test.rs` | Modify | GitHub-indexed recipes carry tags and feed title. |

---

### Task 1: Branch and baseline

**Files:** none

- [ ] **Step 1: Create the branch**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/recipe-hub-api
```

- [ ] **Step 2: Confirm the baseline is green**

Run: `cargo test 2>&1 | grep -E "^test result|FAILED|panicked"`
Expected: every line is `test result: ok.`; the lib line reads `110 passed; 0 failed`.

- [ ] **Step 3: Confirm lint baseline**

Run: `cargo clippy --all-targets --all-features -- -D warnings && cargo fmt --all -- --check`
Expected: exits 0. If it does not, stop and report: CI (`.github/workflows/test.yml`) runs both of these, and every later task assumes they pass.

---

### Task 2: Schema fields for filters and cards

**Files:**
- Modify: `src/indexer/schema.rs:12-90` (struct + `new()`), tests at `:112-123`

- [ ] **Step 1: Write the failing test**

Append inside `mod tests` in `src/indexer/schema.rs` (after `test_schema_creation`):

```rust
    #[test]
    fn test_filter_fields_are_indexed_and_card_fields_are_stored() {
        let s = RecipeSchema::new();

        // Range and exact-match filters need INDEXED; FAST keeps sorting and
        // fast-field range queries cheap; STORED feeds result cards.
        for field in [s.total_time, s.servings, s.feed_id] {
            let entry = s.schema.get_field_entry(field);
            assert!(
                entry.is_indexed() && entry.is_fast() && entry.is_stored(),
                "{} must be INDEXED | FAST | STORED",
                entry.name()
            );
        }

        let indexed_at = s.schema.get_field_entry(s.indexed_at);
        assert!(indexed_at.is_fast() && indexed_at.is_stored());

        // Card-only fields are stored, never searched.
        for field in [s.image_url, s.feed_title] {
            let entry = s.schema.get_field_entry(field);
            assert!(
                entry.is_stored() && !entry.is_indexed(),
                "{} must be stored only",
                entry.name()
            );
        }
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test --lib test_filter_fields_are_indexed_and_card_fields_are_stored`
Expected: compile error `error[E0609]: no field `feed_id` on type `RecipeSchema`` (and the same for `indexed_at`, `image_url`, `feed_title`).

- [ ] **Step 3: Implement**

In `src/indexer/schema.rs`, replace the `RecipeSchema` struct (lines 12-27) with:

```rust
/// Schema for recipe search index
#[derive(Clone)]
pub struct RecipeSchema {
    pub schema: Schema,
    pub id: Field,
    pub title: Field,
    pub summary: Field,
    pub instructions: Field,
    pub ingredients: Field,
    pub tags: Field,
    pub difficulty: Field,
    pub servings: Field,
    pub total_time: Field,
    pub file_path: Field,
    pub locale: Field,
    /// Feed the recipe came from (exact-match filter, card field).
    pub feed_id: Field,
    /// Unix seconds when the recipe entered the federation; `sort=newest` key.
    pub indexed_at: Field,
    /// Card-only: stored for result cards, never searched.
    pub image_url: Field,
    /// Card-only: the feed's title at index time.
    pub feed_title: Field,
}
```

In `new()`, replace the servings and total_time lines (currently 60-64) with:

```rust
        // Servings (filterable: range queries and `servings:4` terms)
        let servings = schema_builder.add_i64_field("servings", FAST | INDEXED | STORED);

        // Total time in minutes (filterable: range queries and terms)
        let total_time = schema_builder.add_i64_field("total_time", FAST | INDEXED | STORED);
```

After the `locale` field (currently line 71) and before `let schema = schema_builder.build();`, add:

```rust
        // Feed id (exact-match filter, shown on cards)
        let feed_id = schema_builder.add_i64_field("feed_id", FAST | INDEXED | STORED);

        // When the recipe entered the federation, unix seconds (sort key)
        let indexed_at = schema_builder.add_i64_field("indexed_at", FAST | STORED);

        // Stored only, for result cards
        let image_url = schema_builder.add_text_field("image_url", STORED);
        let feed_title = schema_builder.add_text_field("feed_title", STORED);
```

Replace the `Self { ... }` literal at the end of `new()` with:

```rust
        Self {
            schema,
            id,
            title,
            summary,
            instructions,
            ingredients,
            tags,
            difficulty,
            servings,
            total_time,
            file_path,
            locale,
            feed_id,
            indexed_at,
            image_url,
            feed_title,
        }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib schema::tests`
Expected: `test result: ok. 2 passed`.
Run: `cargo test 2>&1 | grep -E "^test result|FAILED"`
Expected: all ok. Existing indexes are rebuilt in temp dirs, so the schema change breaks no test. `test_opening_an_index_with_a_stale_schema_is_refused` still passes.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/indexer/schema.rs
git commit -m "Add feed, timestamp and card fields to the search schema"
```

---

### Task 3: Store card fields when indexing; delete placeholder methods

**Files:**
- Create: `src/indexer/filters.rs`
- Create: `src/indexer/extras.rs`
- Modify: `src/indexer/mod.rs:4-9`
- Modify: `src/indexer/search.rs:1-12` (imports), `:102-204` (`index_recipe` + placeholders)
- Test: new `mod card_tests` at the end of `src/indexer/search.rs`

- [ ] **Step 1: Write the failing tests**

Create `src/indexer/filters.rs`:

```rust
//! Structured search filters, applied on top of the free-text query.

/// Canonical form of a difficulty value, used both when indexing and when
/// filtering: trimmed and lowercased, so "Easy " matches `difficulty=easy`.
pub fn normalize_difficulty(value: &str) -> String {
    value.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn difficulty_is_trimmed_and_lowercased() {
        assert_eq!(normalize_difficulty("  Easy "), "easy");
        assert_eq!(normalize_difficulty("HARD"), "hard");
    }
}
```

Create `src/indexer/extras.rs`:

```rust
//! Inputs to a search document that live outside the `recipes` row.

/// Everything indexed alongside a recipe row that comes from other tables:
/// its GitHub file path, tag and ingredient names, and its feed's title.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IndexExtras {
    pub file_path: Option<String>,
    pub tags: Vec<String>,
    pub ingredients: Vec<String>,
    pub feed_title: Option<String>,
}
```

In `src/indexer/mod.rs`, replace the module list (lines 4-9) with:

```rust
pub mod cooklang_parser;
pub mod extras;
pub mod filters;
pub mod locale;
mod plain_text;
pub mod recipe;
pub mod schema;
pub mod search;
```

Append to the end of `src/indexer/search.rs`:

```rust
#[cfg(test)]
mod card_tests {
    use super::*;
    use crate::db::models::Recipe;
    use crate::indexer::extras::IndexExtras;
    use chrono::TimeZone;
    use tantivy::schema::Value;
    use tempfile::tempdir;

    fn created_at() -> chrono::DateTime<chrono::Utc> {
        chrono::Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap()
    }

    fn card_recipe() -> Recipe {
        Recipe {
            id: 7,
            feed_id: 12,
            external_id: "ext-7".to_string(),
            title: "Lemon Tart".to_string(),
            source_url: Some("https://example.com/lemon-tart".to_string()),
            enclosure_url: "https://example.com/lemon-tart.cook".to_string(),
            content: Some("Bake the @pastry{}.".to_string()),
            summary: Some("Sharp and sweet.".to_string()),
            servings: Some(6),
            total_time_minutes: Some(45),
            active_time_minutes: Some(20),
            difficulty: Some(" Easy ".to_string()),
            image_url: Some("https://example.com/lemon-tart.jpg".to_string()),
            published_at: None,
            updated_at: None,
            indexed_at: None,
            created_at: created_at(),
            content_hash: None,
            content_etag: None,
            content_last_modified: None,
            feed_entry_updated: None,
            locale: Some("en".to_string()),
            locale_source: Some("declared".to_string()),
        }
    }

    fn card_extras() -> IndexExtras {
        IndexExtras {
            file_path: None,
            tags: vec!["dessert".to_string()],
            ingredients: vec!["pastry".to_string()],
            feed_title: Some("Jane's Kitchen".to_string()),
        }
    }

    #[test]
    fn index_recipe_full_stores_card_fields() {
        let dir = tempdir().unwrap();
        let index = SearchIndex::new(dir.path()).unwrap();
        let mut writer = index.writer().unwrap();
        index
            .index_recipe_full(&mut writer, &card_recipe(), &card_extras())
            .unwrap();
        index.commit(&mut writer).unwrap();

        let searcher = index.reader.searcher();
        let top = searcher
            .search(&tantivy::query::AllQuery, &TopDocs::with_limit(1))
            .unwrap();
        let doc = searcher
            .doc::<tantivy::TantivyDocument>(top[0].1)
            .unwrap();

        assert_eq!(
            doc.get_first(index.schema.feed_id).and_then(|v| v.as_i64()),
            Some(12)
        );
        assert_eq!(
            doc.get_first(index.schema.indexed_at)
                .and_then(|v| v.as_i64()),
            Some(created_at().timestamp()),
            "indexed_at falls back to created_at"
        );
        assert_eq!(
            doc.get_first(index.schema.image_url).and_then(|v| v.as_str()),
            Some("https://example.com/lemon-tart.jpg")
        );
        assert_eq!(
            doc.get_first(index.schema.feed_title)
                .and_then(|v| v.as_str()),
            Some("Jane's Kitchen")
        );
        assert_eq!(
            doc.get_first(index.schema.difficulty)
                .and_then(|v| v.as_str()),
            Some("easy"),
            "difficulty is normalised at index time"
        );
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib card_tests`
Expected: compile error `no method named `index_recipe_full` found for struct `SearchIndex``.

- [ ] **Step 3: Implement**

In `src/indexer/search.rs`, replace the import block (lines 1-12) with:

```rust
use crate::db::models::Recipe;
use crate::error::{Error, Result};
use crate::indexer::extras::IndexExtras;
use crate::indexer::filters::normalize_difficulty;
use crate::indexer::locale::normalize_code;
use crate::indexer::plain_text::instructions_text;
use crate::indexer::schema::RecipeSchema;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tantivy::collector::{Count, TopDocs};
use tantivy::query::{BooleanQuery, Occur, Query, QueryParser, TermQuery};
use tantivy::schema::IndexRecordOption;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, Term};
use tracing::{debug, info};
```

Replace lines 102-204 (the doc comment `/// Index a recipe` through the end of `add_recipe_ingredients`) with:

```rust
    /// Index a recipe with everything a search document carries: the row's own
    /// fields plus the tags, ingredients, file path and feed title in `extras`.
    /// Deletes any existing document for the recipe first, so re-indexing is
    /// idempotent.
    pub fn index_recipe_full(
        &self,
        writer: &mut IndexWriter,
        recipe: &Recipe,
        extras: &IndexExtras,
    ) -> Result<()> {
        debug!("Indexing recipe: {}", recipe.id);

        // Delete existing documents with this recipe_id FIRST
        let term = Term::from_field_i64(self.schema.id, recipe.id);
        writer.delete_term(term);

        // `indexed_at` in the DB is optional; the row's creation time is when the
        // recipe entered the federation, which is what `sort=newest` means.
        let indexed_at = recipe.indexed_at.unwrap_or(recipe.created_at).timestamp();

        let mut doc = doc!(
            self.schema.id => recipe.id,
            self.schema.title => recipe.title.clone(),
            self.schema.feed_id => recipe.feed_id,
            self.schema.indexed_at => indexed_at,
        );

        if let Some(summary) = &recipe.summary {
            doc.add_text(self.schema.summary, summary);
        }

        // Add instructions as rendered prose, not raw Cooklang markup
        if let Some(content) = &recipe.content {
            doc.add_text(self.schema.instructions, instructions_text(content));
        }

        if let Some(servings) = recipe.servings {
            doc.add_i64(self.schema.servings, servings);
        }

        if let Some(time) = recipe.total_time_minutes {
            doc.add_i64(self.schema.total_time, time);
        }

        // Difficulty is an exact-match field: store it canonically so the
        // `difficulty=` filter and facet values agree.
        if let Some(difficulty) = &recipe.difficulty {
            let difficulty = normalize_difficulty(difficulty);
            if !difficulty.is_empty() {
                doc.add_text(self.schema.difficulty, difficulty);
            }
        }

        if let Some(image_url) = &recipe.image_url {
            doc.add_text(self.schema.image_url, image_url);
        }

        if let Some(feed_title) = &extras.feed_title {
            doc.add_text(self.schema.feed_title, feed_title);
        }

        // Add file path (for GitHub recipes)
        if let Some(path) = &extras.file_path {
            doc.add_text(self.schema.file_path, path);
        }

        // Add locale, plus its base language when the code carries a region, so a
        // filter on "en" also matches an "en-US" recipe.
        if let Some(locale) = &recipe.locale {
            doc.add_text(self.schema.locale, locale);

            if let Some((language, _region)) = locale.split_once('-') {
                doc.add_text(self.schema.locale, language);
            }
        }

        for tag in &extras.tags {
            doc.add_text(self.schema.tags, tag);
        }

        for ingredient in &extras.ingredients {
            doc.add_text(self.schema.ingredients, ingredient);
        }

        writer.add_document(doc)?;

        Ok(())
    }

    /// Index a recipe without a feed title. Kept for tests and simple callers;
    /// production paths load [`IndexExtras`] and call [`Self::index_recipe_full`].
    pub fn index_recipe(
        &self,
        writer: &mut IndexWriter,
        recipe: &Recipe,
        file_path: Option<&str>,
        tags: &[String],
        ingredients: &[String],
    ) -> Result<()> {
        self.index_recipe_full(
            writer,
            recipe,
            &IndexExtras {
                file_path: file_path.map(str::to_string),
                tags: tags.to_vec(),
                ingredients: ingredients.to_vec(),
                feed_title: None,
            },
        )
    }
```

(The placeholders `add_recipe_tags` / `add_recipe_ingredients` on `SearchIndex` are gone. They had no callers; `db::tags::add_recipe_tags` and `db::ingredients::add_recipe_ingredients` are different functions and stay.)

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib card_tests && cargo test --lib filters::tests`
Expected: both `ok`.
Run: `cargo test 2>&1 | grep -E "^test result|FAILED"`
Expected: all ok.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/indexer/filters.rs src/indexer/extras.rs src/indexer/mod.rs src/indexer/search.rs
git commit -m "Store card fields in search documents; drop no-op index placeholders"
```

---

### Task 4: Card fields on search results

**Files:**
- Modify: `src/indexer/search.rs` (`SearchResult` struct, lines 29-36; results mapping in `search`, lines ~283-316 before this task's edit)
- Test: `mod card_tests` in `src/indexer/search.rs`

- [ ] **Step 1: Write the failing tests**

Append inside `mod card_tests`:

```rust
    fn query(q: &str) -> SearchQuery {
        SearchQuery {
            q: q.to_string(),
            page: 1,
            limit: 10,
            locale: None,
        }
    }

    #[test]
    fn search_results_carry_card_fields() {
        let dir = tempdir().unwrap();
        let index = SearchIndex::new(dir.path()).unwrap();
        let mut writer = index.writer().unwrap();
        index
            .index_recipe_full(&mut writer, &card_recipe(), &card_extras())
            .unwrap();
        index.commit(&mut writer).unwrap();

        let results = index.search(&query("tart"), 10).unwrap();
        let card = &results.results[0];

        assert_eq!(card.recipe_id, 7);
        assert_eq!(card.total_time_minutes, Some(45));
        assert_eq!(card.servings, Some(6));
        assert_eq!(card.difficulty.as_deref(), Some("easy"));
        assert_eq!(
            card.image_url.as_deref(),
            Some("https://example.com/lemon-tart.jpg")
        );
        assert_eq!(card.feed_id, Some(12));
        assert_eq!(card.feed_title.as_deref(), Some("Jane's Kitchen"));
    }

    #[test]
    fn search_results_leave_missing_card_fields_empty() {
        let dir = tempdir().unwrap();
        let index = SearchIndex::new(dir.path()).unwrap();
        let mut writer = index.writer().unwrap();
        let bare = Recipe {
            servings: None,
            total_time_minutes: None,
            difficulty: None,
            image_url: None,
            ..card_recipe()
        };
        index
            .index_recipe(&mut writer, &bare, None, &[], &[])
            .unwrap();
        index.commit(&mut writer).unwrap();

        let results = index.search(&query("tart"), 10).unwrap();
        let card = &results.results[0];

        assert_eq!(card.total_time_minutes, None);
        assert_eq!(card.servings, None);
        assert_eq!(card.difficulty, None);
        assert_eq!(card.image_url, None);
        assert_eq!(card.feed_title, None);
        assert_eq!(card.feed_id, Some(12), "feed_id is always indexed");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib card_tests`
Expected: compile error `no field `total_time_minutes` on type `&SearchResult``.

- [ ] **Step 3: Implement**

Replace the `SearchResult` struct with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub recipe_id: i64,
    pub title: String,
    pub summary: Option<String>,
    pub score: f32,
    pub locale: Option<String>,
    pub total_time_minutes: Option<i64>,
    pub servings: Option<i64>,
    pub difficulty: Option<String>,
    pub image_url: Option<String>,
    pub feed_id: Option<i64>,
    pub feed_title: Option<String>,
}
```

In `search`, replace the whole `let results: Vec<SearchResult> = top_docs ... .collect();` statement (the `filter_map` that reads `id`, `title`, `summary` and `locale`) with:

```rust
        let results: Vec<SearchResult> = top_docs
            .into_iter()
            .filter_map(|(score, doc_address)| {
                let doc = searcher
                    .doc::<tantivy::TantivyDocument>(doc_address)
                    .ok()?;
                self.result_from_doc(&doc, score)
            })
            .collect();
```

Add this method inside `impl SearchIndex` (directly after `search`):

```rust
    /// Build a result card from a stored document. Returns `None` only for a
    /// document without an id or title, which the indexer never writes.
    fn result_from_doc(&self, doc: &tantivy::TantivyDocument, score: f32) -> Option<SearchResult> {
        Some(SearchResult {
            recipe_id: stored_i64(doc, self.schema.id)?,
            title: stored_str(doc, self.schema.title)?,
            summary: stored_str(doc, self.schema.summary),
            score,
            locale: stored_str(doc, self.schema.locale),
            total_time_minutes: stored_i64(doc, self.schema.total_time),
            servings: stored_i64(doc, self.schema.servings),
            difficulty: stored_str(doc, self.schema.difficulty),
            image_url: stored_str(doc, self.schema.image_url),
            feed_id: stored_i64(doc, self.schema.feed_id),
            feed_title: stored_str(doc, self.schema.feed_title),
        })
    }
```

Add these free functions after the closing `}` of `impl SearchIndex` and before the first `#[cfg(test)]`:

```rust
/// First stored string value of `field`, if any.
fn stored_str(doc: &tantivy::TantivyDocument, field: tantivy::schema::Field) -> Option<String> {
    match doc.get_first(field)? {
        tantivy::schema::OwnedValue::Str(s) => Some(s.to_string()),
        _ => None,
    }
}

/// First stored i64 value of `field`, if any.
fn stored_i64(doc: &tantivy::TantivyDocument, field: tantivy::schema::Field) -> Option<i64> {
    match doc.get_first(field)? {
        tantivy::schema::OwnedValue::I64(value) => Some(*value),
        _ => None,
    }
}
```

The locale field stores the full code first and the base language second, so `stored_str` still returns `en-US` for a regional recipe, as today.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib search`
Expected: all `indexer::search` tests pass, including `test_regional_locale_matches_base_language_filter`.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/indexer/search.rs
git commit -m "Return card fields from stored search documents"
```

---

### Task 5: `SearchFilters` and tag/ingredient filters

**Files:**
- Modify: `src/indexer/filters.rs` (whole file)
- Modify: `src/indexer/search.rs` (imports; replace `search` with `search` + `search_with`; add `filter_clauses`, `text_match_query`, `unscored`)
- Test: new `mod filter_tests` at the end of `src/indexer/search.rs`

- [ ] **Step 1: Write the failing tests**

Replace `src/indexer/filters.rs` entirely with:

```rust
//! Structured search filters, applied on top of the free-text query.

use serde::{Deserialize, Serialize};

/// Structured filters for a search. Each populated filter narrows the result
/// set; they combine with the free-text query and with each other (AND).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchFilters {
    /// The recipe has every one of these tags.
    pub tags: Vec<String>,
    /// The recipe uses every one of these ingredients.
    pub include_ingredients: Vec<String>,
    /// The recipe uses none of these ingredients.
    pub exclude_ingredients: Vec<String>,
    /// Total time at most this many minutes.
    pub max_time: Option<i64>,
    /// Servings at least this many (inclusive).
    pub min_servings: Option<i64>,
    /// Servings at most this many (inclusive).
    pub max_servings: Option<i64>,
    /// Exact difficulty; compared after [`normalize_difficulty`].
    pub difficulty: Option<String>,
    /// Only recipes from this feed.
    pub feed_id: Option<i64>,
}

impl SearchFilters {
    /// True when no filter is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Result ordering.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    /// Best match first (BM25 with field boosts).
    #[default]
    Relevance,
    /// Most recently added to the federation first.
    Newest,
}

/// Canonical form of a difficulty value, used both when indexing and when
/// filtering: trimmed and lowercased, so "Easy " matches `difficulty=easy`.
pub fn normalize_difficulty(value: &str) -> String {
    value.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn difficulty_is_trimmed_and_lowercased() {
        assert_eq!(normalize_difficulty("  Easy "), "easy");
        assert_eq!(normalize_difficulty("HARD"), "hard");
    }

    #[test]
    fn default_filters_are_empty() {
        assert!(SearchFilters::default().is_empty());
        let filters = SearchFilters {
            max_time: Some(30),
            ..SearchFilters::default()
        };
        assert!(!filters.is_empty());
    }
}
```

Append to the end of `src/indexer/search.rs`:

```rust
#[cfg(test)]
mod filter_tests {
    use super::*;
    use crate::db::models::Recipe;
    use crate::indexer::extras::IndexExtras;
    use crate::indexer::filters::SearchFilters;
    use chrono::TimeZone;
    use tempfile::{tempdir, TempDir};

    struct Fixture {
        index: SearchIndex,
        _dir: TempDir,
    }

    struct Spec {
        id: i64,
        title: &'static str,
        feed_id: i64,
        tags: &'static [&'static str],
        ingredients: &'static [&'static str],
        total_time: Option<i64>,
        servings: Option<i64>,
        difficulty: Option<&'static str>,
        locale: Option<&'static str>,
        created_day: u32,
    }

    fn recipe(spec: &Spec) -> Recipe {
        Recipe {
            id: spec.id,
            feed_id: spec.feed_id,
            external_id: format!("ext-{}", spec.id),
            title: spec.title.to_string(),
            source_url: None,
            enclosure_url: format!("https://example.com/{}.cook", spec.id),
            content: Some("Cook it.".to_string()),
            summary: None,
            servings: spec.servings,
            total_time_minutes: spec.total_time,
            active_time_minutes: None,
            difficulty: spec.difficulty.map(str::to_string),
            image_url: None,
            published_at: None,
            updated_at: None,
            indexed_at: None,
            created_at: chrono::Utc
                .with_ymd_and_hms(2026, 1, spec.created_day, 0, 0, 0)
                .unwrap(),
            content_hash: None,
            content_etag: None,
            content_last_modified: None,
            feed_entry_updated: None,
            locale: spec.locale.map(str::to_string),
            locale_source: None,
        }
    }

    fn fixture(specs: &[Spec]) -> Fixture {
        let dir = tempdir().unwrap();
        let index = SearchIndex::new(dir.path()).unwrap();
        let mut writer = index.writer().unwrap();
        for spec in specs {
            let extras = IndexExtras {
                file_path: None,
                tags: strings(spec.tags),
                ingredients: strings(spec.ingredients),
                feed_title: None,
            };
            index
                .index_recipe_full(&mut writer, &recipe(spec), &extras)
                .unwrap();
        }
        index.commit(&mut writer).unwrap();
        Fixture { index, _dir: dir }
    }

    /// Four recipes over two feeds, two languages and four creation days.
    fn corpus() -> Fixture {
        fixture(&[
            Spec {
                id: 1,
                title: "Vegan Chocolate Cake",
                feed_id: 10,
                tags: &["vegan", "desserts"],
                ingredients: &["cocoa", "flour"],
                total_time: Some(60),
                servings: Some(8),
                difficulty: Some("Medium"),
                locale: Some("en"),
                created_day: 1,
            },
            Spec {
                id: 2,
                title: "Garlic Lemon Chicken",
                feed_id: 10,
                tags: &["dinner"],
                ingredients: &["garlic", "lemon", "chicken thigh"],
                total_time: Some(30),
                servings: Some(4),
                difficulty: Some("easy"),
                locale: Some("en"),
                created_day: 3,
            },
            Spec {
                id: 3,
                title: "Peanut Noodles",
                feed_id: 20,
                tags: &["dinner", "vegan"],
                ingredients: &["peanut butter", "noodles", "garlic"],
                total_time: Some(15),
                servings: Some(2),
                difficulty: Some("easy"),
                locale: Some("en"),
                created_day: 2,
            },
            Spec {
                id: 4,
                title: "Zitronenkuchen",
                feed_id: 20,
                tags: &["dessert"],
                ingredients: &["lemon", "flour"],
                total_time: None,
                servings: None,
                difficulty: None,
                locale: Some("de"),
                created_day: 4,
            },
        ])
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn query(q: &str, locale: Option<&str>) -> SearchQuery {
        SearchQuery {
            q: q.to_string(),
            page: 1,
            limit: 50,
            locale: locale.map(str::to_string),
        }
    }

    /// Matching ids, sorted, for relevance searches (order is not under test).
    fn ids(fixture: &Fixture, q: &str, locale: Option<&str>, filters: &SearchFilters) -> Vec<i64> {
        let mut ids: Vec<i64> = fixture
            .index
            .search_with(&query(q, locale), filters, 100)
            .unwrap()
            .results
            .iter()
            .map(|r| r.recipe_id)
            .collect();
        ids.sort();
        ids
    }

    fn tags(items: &[&str]) -> SearchFilters {
        SearchFilters {
            tags: strings(items),
            ..SearchFilters::default()
        }
    }

    #[test]
    fn tags_filter_requires_every_tag() {
        let f = corpus();
        assert_eq!(ids(&f, "", None, &tags(&["vegan"])), vec![1, 3]);
        assert_eq!(ids(&f, "", None, &tags(&["vegan", "dinner"])), vec![3]);
    }

    #[test]
    fn tags_filter_is_stemmed_and_case_insensitive() {
        let f = corpus();
        // "Desserts" and the stored "desserts"/"dessert" all stem to "dessert".
        assert_eq!(ids(&f, "", None, &tags(&["Desserts"])), vec![1, 4]);
    }

    #[test]
    fn blank_filter_values_are_ignored() {
        let f = corpus();
        assert_eq!(ids(&f, "", None, &tags(&[" "])), vec![1, 2, 3, 4]);
    }

    #[test]
    fn include_ingredients_requires_every_ingredient() {
        let f = corpus();
        let filters = SearchFilters {
            include_ingredients: strings(&["garlic", "lemon"]),
            ..SearchFilters::default()
        };
        assert_eq!(ids(&f, "", None, &filters), vec![2]);

        let filters = SearchFilters {
            include_ingredients: strings(&["garlic"]),
            ..SearchFilters::default()
        };
        assert_eq!(ids(&f, "", None, &filters), vec![2, 3]);
    }

    #[test]
    fn multi_word_ingredient_matches_as_a_phrase() {
        let f = corpus();
        let filters = SearchFilters {
            include_ingredients: strings(&["peanut butter"]),
            ..SearchFilters::default()
        };
        assert_eq!(ids(&f, "", None, &filters), vec![3]);

        let filters = SearchFilters {
            include_ingredients: strings(&["butter peanut"]),
            ..SearchFilters::default()
        };
        assert!(ids(&f, "", None, &filters).is_empty(), "word order matters");
    }

    #[test]
    fn exclude_ingredients_removes_any_match() {
        let f = corpus();
        let filters = SearchFilters {
            exclude_ingredients: strings(&["peanut"]),
            ..SearchFilters::default()
        };
        assert_eq!(ids(&f, "", None, &filters), vec![1, 2, 4]);

        let filters = SearchFilters {
            exclude_ingredients: strings(&["garlic", "flour"]),
            ..SearchFilters::default()
        };
        assert!(ids(&f, "", None, &filters).is_empty());
    }

    #[test]
    fn filters_combine_with_query_and_locale() {
        let f = corpus();
        assert_eq!(ids(&f, "lemon", Some("de"), &tags(&["dessert"])), vec![4]);

        let filters = SearchFilters {
            include_ingredients: strings(&["garlic"]),
            ..SearchFilters::default()
        };
        assert_eq!(ids(&f, "lemon", None, &filters), vec![2]);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib filter_tests`
Expected: compile error `no method named `search_with` found for struct `SearchIndex``.

- [ ] **Step 3: Implement**

In `src/indexer/search.rs`, replace the import block with:

```rust
use crate::db::models::Recipe;
use crate::error::{Error, Result};
use crate::indexer::extras::IndexExtras;
use crate::indexer::filters::{normalize_difficulty, SearchFilters};
use crate::indexer::locale::normalize_code;
use crate::indexer::plain_text::instructions_text;
use crate::indexer::schema::RecipeSchema;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tantivy::collector::{Count, TopDocs};
use tantivy::query::{
    BooleanQuery, ConstScoreQuery, Occur, PhraseQuery, Query, QueryParser, TermQuery,
};
use tantivy::schema::IndexRecordOption;
use tantivy::tokenizer::TokenStream;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, Term};
use tracing::{debug, info};
```

Replace the whole `search` method (from `/// Search recipes using unified query string` through its closing `}`) with:

```rust
    /// Search recipes using unified query string
    pub fn search(&self, query: &SearchQuery, max_limit: usize) -> Result<SearchResults> {
        self.search_with(query, &SearchFilters::default(), max_limit)
    }

    /// Search with structured filters ANDed onto the parsed query string.
    pub fn search_with(
        &self,
        query: &SearchQuery,
        filters: &SearchFilters,
        max_limit: usize,
    ) -> Result<SearchResults> {
        let searcher = self.reader.searcher();

        // Build query parser over the fields free text should search. The file
        // path is excluded: directory names are not recipe content, but it can
        // still be targeted explicitly with `file_path:`.
        let mut query_parser = QueryParser::for_index(
            &self.index,
            vec![
                self.schema.title,
                self.schema.summary,
                self.schema.instructions,
                self.schema.ingredients,
                self.schema.tags,
                self.schema.difficulty,
            ],
        );

        // A word in the title or tags says more about a recipe than the same word
        // buried in a step.
        query_parser.set_field_boost(self.schema.title, 3.0);
        query_parser.set_field_boost(self.schema.tags, 2.0);
        query_parser.set_field_boost(self.schema.ingredients, 1.5);

        // Every term narrows the result set: `vegan tags:dessert` means vegan AND
        // dessert. Tantivy's default is OR, which turns field filters into suggestions.
        query_parser.set_conjunction_by_default();

        // Parse unified query string
        let parsed_query = if query.q.is_empty() {
            Box::new(tantivy::query::AllQuery) as Box<dyn Query>
        } else {
            query_parser
                .parse_query(&query.q)
                .map_err(|e| Error::Search(format!("Invalid query: {e}")))?
        };

        let mut clauses: Vec<(Occur, Box<dyn Query>)> = vec![(Occur::Must, parsed_query)];

        // AND an exact locale term onto the parsed query when filtering. The locale
        // field is untokenized (exact match), so normalize the incoming filter to the
        // canonical stored form first — otherwise `?locale=EN` or `?locale=en-us`
        // would silently match nothing.
        if let Some(locale) = query.locale.as_deref().filter(|l| !l.is_empty()) {
            let term = Term::from_field_text(self.schema.locale, &normalize_code(locale));
            clauses.push((
                Occur::Must,
                Box::new(TermQuery::new(term, IndexRecordOption::Basic)),
            ));
        }

        clauses.extend(self.filter_clauses(filters)?);

        let tantivy_query: Box<dyn Query> = if clauses.len() == 1 {
            clauses.remove(0).1
        } else {
            Box::new(BooleanQuery::new(clauses))
        };

        // Calculate offset
        let offset = (query.page.saturating_sub(1)) * query.limit;
        let limit = query.limit.min(max_limit);

        // Execute search: the page of hits plus a full count in one pass.
        let (top_docs, total) = searcher
            .search(
                &*tantivy_query,
                &(TopDocs::with_limit(limit).and_offset(offset), Count),
            )
            .map_err(|e| Error::Search(format!("Search failed: {e}")))?;

        let results: Vec<SearchResult> = top_docs
            .into_iter()
            .filter_map(|(score, doc_address)| {
                let doc = searcher
                    .doc::<tantivy::TantivyDocument>(doc_address)
                    .ok()?;
                self.result_from_doc(&doc, score)
            })
            .collect();

        let total_pages = total.div_ceil(limit);

        Ok(SearchResults {
            results,
            total,
            page: query.page,
            total_pages,
        })
    }

    /// Query clauses for the structured filters. Positive filters are wrapped
    /// in a zero constant score, so they narrow results without changing how
    /// the free-text query ranks them.
    fn filter_clauses(&self, filters: &SearchFilters) -> Result<Vec<(Occur, Box<dyn Query>)>> {
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();

        for tag in &filters.tags {
            if let Some(query) = self.text_match_query(self.schema.tags, tag)? {
                clauses.push((Occur::Must, unscored(query)));
            }
        }

        for ingredient in &filters.include_ingredients {
            if let Some(query) = self.text_match_query(self.schema.ingredients, ingredient)? {
                clauses.push((Occur::Must, unscored(query)));
            }
        }

        for ingredient in &filters.exclude_ingredients {
            if let Some(query) = self.text_match_query(self.schema.ingredients, ingredient)? {
                clauses.push((Occur::MustNot, query));
            }
        }

        Ok(clauses)
    }

    /// A query matching `text` in `field` after running it through that field's
    /// analyzer, so a filter value is lowercased and stemmed exactly like the
    /// indexed values. One token becomes a term query and several become a phrase.
    /// Text that yields no tokens returns `None`, which means no filter.
    fn text_match_query(
        &self,
        field: tantivy::schema::Field,
        text: &str,
    ) -> Result<Option<Box<dyn Query>>> {
        let mut analyzer = self
            .index
            .tokenizer_for_field(field)
            .map_err(|e| Error::Search(format!("No analyzer for field: {e}")))?;

        let mut terms = Vec::new();
        {
            let mut stream = analyzer.token_stream(text);
            stream.process(&mut |token| terms.push(Term::from_field_text(field, &token.text)));
        }

        Ok(match terms.len() {
            0 => None,
            1 => Some(Box::new(TermQuery::new(terms.remove(0), IndexRecordOption::Basic))
                as Box<dyn Query>),
            _ => Some(Box::new(PhraseQuery::new(terms)) as Box<dyn Query>),
        })
    }
```

Add after `stored_i64` (outside the impl):

```rust
/// Wrap a filter so it contributes nothing to the relevance score.
fn unscored(query: Box<dyn Query>) -> Box<dyn Query> {
    Box::new(ConstScoreQuery::new(query, 0.0))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib filter_tests && cargo test --lib filters::tests`
Expected: `ok`, 7 and 2 passed.
Run: `cargo test --lib search`
Expected: all existing `quality_tests` and `tests` still pass (behaviour without filters is unchanged).

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/indexer/filters.rs src/indexer/search.rs
git commit -m "Add structured tag and ingredient filters to search"
```

---

### Task 6: Time, servings, difficulty and feed filters

**Files:**
- Modify: `src/indexer/search.rs` (imports; `filter_clauses`)
- Test: `mod filter_tests` in `src/indexer/search.rs`

- [ ] **Step 1: Write the failing tests**

Append inside `mod filter_tests`:

```rust
    #[test]
    fn max_time_keeps_recipes_at_or_under_the_limit() {
        let f = corpus();
        let filters = SearchFilters {
            max_time: Some(30),
            ..SearchFilters::default()
        };
        // Recipe 4 has no total time, so it cannot satisfy a time limit.
        assert_eq!(ids(&f, "", None, &filters), vec![2, 3]);
    }

    #[test]
    fn servings_range_is_inclusive() {
        let f = corpus();
        let range = |min: Option<i64>, max: Option<i64>| SearchFilters {
            min_servings: min,
            max_servings: max,
            ..SearchFilters::default()
        };
        assert_eq!(ids(&f, "", None, &range(Some(3), None)), vec![1, 2]);
        assert_eq!(ids(&f, "", None, &range(None, Some(4))), vec![2, 3]);
        assert_eq!(ids(&f, "", None, &range(Some(2), Some(4))), vec![2, 3]);
        assert_eq!(ids(&f, "", None, &range(Some(4), Some(4))), vec![2]);
    }

    #[test]
    fn difficulty_matches_exactly_ignoring_case() {
        let f = corpus();
        let difficulty = |d: &str| SearchFilters {
            difficulty: Some(d.to_string()),
            ..SearchFilters::default()
        };
        assert_eq!(ids(&f, "", None, &difficulty("EASY")), vec![2, 3]);
        assert_eq!(ids(&f, "", None, &difficulty("medium")), vec![1]);
    }

    #[test]
    fn feed_filter_keeps_one_feed() {
        let f = corpus();
        let filters = SearchFilters {
            feed_id: Some(20),
            ..SearchFilters::default()
        };
        assert_eq!(ids(&f, "", None, &filters), vec![3, 4]);
    }

    #[test]
    fn numeric_filters_combine_with_the_query() {
        let f = corpus();
        let filters = SearchFilters {
            max_time: Some(20),
            ..SearchFilters::default()
        };
        assert_eq!(ids(&f, "garlic", None, &filters), vec![3]);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib filter_tests`
Expected: FAIL. For example `max_time_keeps_recipes_at_or_under_the_limit` panics with `left: [1, 2, 3, 4]` / `right: [2, 3]`, because these filters are not applied yet.

- [ ] **Step 3: Implement**

Add to the imports of `src/indexer/search.rs`: `use std::ops::Bound;`, and add `RangeQuery` to the `tantivy::query::{...}` list:

```rust
use std::ops::Bound;
use tantivy::query::{
    BooleanQuery, ConstScoreQuery, Occur, PhraseQuery, Query, QueryParser, RangeQuery, TermQuery,
};
```

Replace the whole `filter_clauses` method with:

```rust
    /// Query clauses for the structured filters. Positive filters are wrapped
    /// in a zero constant score, so they narrow results without changing how
    /// the free-text query ranks them.
    fn filter_clauses(&self, filters: &SearchFilters) -> Result<Vec<(Occur, Box<dyn Query>)>> {
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();

        for tag in &filters.tags {
            if let Some(query) = self.text_match_query(self.schema.tags, tag)? {
                clauses.push((Occur::Must, unscored(query)));
            }
        }

        for ingredient in &filters.include_ingredients {
            if let Some(query) = self.text_match_query(self.schema.ingredients, ingredient)? {
                clauses.push((Occur::Must, unscored(query)));
            }
        }

        for ingredient in &filters.exclude_ingredients {
            if let Some(query) = self.text_match_query(self.schema.ingredients, ingredient)? {
                clauses.push((Occur::MustNot, query));
            }
        }

        if let Some(max_time) = filters.max_time {
            let range = RangeQuery::new_i64_bounds(
                "total_time".to_string(),
                Bound::Unbounded,
                Bound::Included(max_time),
            );
            clauses.push((Occur::Must, unscored(Box::new(range))));
        }

        if filters.min_servings.is_some() || filters.max_servings.is_some() {
            let lower = filters.min_servings.map_or(Bound::Unbounded, Bound::Included);
            let upper = filters.max_servings.map_or(Bound::Unbounded, Bound::Included);
            let range = RangeQuery::new_i64_bounds("servings".to_string(), lower, upper);
            clauses.push((Occur::Must, unscored(Box::new(range))));
        }

        if let Some(difficulty) = &filters.difficulty {
            let term =
                Term::from_field_text(self.schema.difficulty, &normalize_difficulty(difficulty));
            clauses.push((
                Occur::Must,
                unscored(Box::new(TermQuery::new(term, IndexRecordOption::Basic))),
            ));
        }

        if let Some(feed_id) = filters.feed_id {
            let term = Term::from_field_i64(self.schema.feed_id, feed_id);
            clauses.push((
                Occur::Must,
                unscored(Box::new(TermQuery::new(term, IndexRecordOption::Basic))),
            ));
        }

        Ok(clauses)
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib filter_tests`
Expected: `ok. 12 passed`.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/indexer/search.rs
git commit -m "Add time, servings, difficulty and feed filters to search"
```

---

### Task 7: `sort=newest` and a safe page size

**Files:**
- Modify: `src/indexer/search.rs` (imports; `search`, `search_with` signature + execution block)
- Test: `mod filter_tests` in `src/indexer/search.rs`

- [ ] **Step 1: Write the failing tests**

In `mod filter_tests`, change the imports line `use crate::indexer::filters::SearchFilters;` to:

```rust
    use crate::indexer::filters::{SearchFilters, SortOrder};
```

Replace the `ids` helper's search call `.search_with(&query(q, locale), filters, 100)` with `.search_with(&query(q, locale), filters, SortOrder::Relevance, 100)`.

Append inside `mod filter_tests`:

```rust
    /// Ids in the order returned, newest first.
    fn newest_ids(fixture: &Fixture, q: &str, page: usize, limit: usize) -> Vec<i64> {
        let query = SearchQuery {
            q: q.to_string(),
            page,
            limit,
            locale: None,
        };
        fixture
            .index
            .search_with(&query, &SearchFilters::default(), SortOrder::Newest, 100)
            .unwrap()
            .results
            .iter()
            .map(|r| r.recipe_id)
            .collect()
    }

    #[test]
    fn newest_orders_by_creation_time_descending() {
        let f = corpus();
        // Created on days 1, 3, 2, 4 respectively.
        assert_eq!(newest_ids(&f, "", 1, 10), vec![4, 2, 3, 1]);
    }

    #[test]
    fn newest_applies_to_query_matches_and_pages() {
        let f = corpus();
        assert_eq!(newest_ids(&f, "lemon", 1, 10), vec![4, 2]);
        assert_eq!(newest_ids(&f, "", 2, 2), vec![3, 1]);
    }

    #[test]
    fn a_zero_limit_returns_one_result_instead_of_panicking() {
        let f = corpus();
        let query = SearchQuery {
            q: String::new(),
            page: 1,
            limit: 0,
            locale: None,
        };
        let results = f
            .index
            .search_with(&query, &SearchFilters::default(), SortOrder::Relevance, 100)
            .unwrap();
        assert_eq!(results.results.len(), 1);
        assert_eq!(results.total, 4);
        assert_eq!(results.total_pages, 4);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib filter_tests`
Expected: compile error `this method takes 3 arguments but 4 arguments were supplied` for `search_with`.

- [ ] **Step 3: Implement**

Imports: change `use crate::indexer::filters::{normalize_difficulty, SearchFilters};` to

```rust
use crate::indexer::filters::{normalize_difficulty, SearchFilters, SortOrder};
```

and change the `tantivy::{...}` root import to

```rust
use tantivy::{doc, DocAddress, Index, IndexReader, IndexWriter, Order, ReloadPolicy, Term};
```

Change `search` to pass the default order:

```rust
    /// Search recipes using unified query string
    pub fn search(&self, query: &SearchQuery, max_limit: usize) -> Result<SearchResults> {
        self.search_with(query, &SearchFilters::default(), SortOrder::Relevance, max_limit)
    }
```

Change the `search_with` signature to:

```rust
    /// Search with structured filters ANDed onto the parsed query string,
    /// ordered by relevance or by `indexed_at` (newest first).
    pub fn search_with(
        &self,
        query: &SearchQuery,
        filters: &SearchFilters,
        sort: SortOrder,
        max_limit: usize,
    ) -> Result<SearchResults> {
```

In `search_with`, replace the block from `// Calculate offset` through `.map_err(|e| Error::Search(format!("Search failed: {e}")))?;` (the `(top_docs, total)` statement) with:

```rust
        // A zero limit would panic inside TopDocs and divide by zero below.
        let limit = query.limit.min(max_limit).max(1);
        let offset = query.page.saturating_sub(1) * limit;

        // Execute search: the page of hits plus a full count in one pass.
        let (top_docs, total): (Vec<(f32, DocAddress)>, usize) = match sort {
            SortOrder::Relevance => searcher
                .search(
                    &*tantivy_query,
                    &(TopDocs::with_limit(limit).and_offset(offset), Count),
                )
                .map_err(|e| Error::Search(format!("Search failed: {e}")))?,
            SortOrder::Newest => {
                let (docs, total) = searcher
                    .search(
                        &*tantivy_query,
                        &(
                            TopDocs::with_limit(limit)
                                .and_offset(offset)
                                .order_by_fast_field::<i64>("indexed_at", Order::Desc),
                            Count,
                        ),
                    )
                    .map_err(|e| Error::Search(format!("Search failed: {e}")))?;
                // Scores are meaningless when ordering by date.
                (docs.into_iter().map(|(_, address)| (0.0, address)).collect(), total)
            }
        };
```

(The offset now uses the clamped page size. Before, it used the requested size, so pages drifted whenever `limit` exceeded `max_limit`.)

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib search`
Expected: all ok, including the 3 new tests and `total_counts_every_hit_and_pages_are_reachable`.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/indexer/search.rs
git commit -m "Add sort=newest and clamp the search page size to at least one"
```

---

### Task 8: A malformed `q` is a 400, not a 500

Today a query that fails to parse becomes `Error::Search`, which `IntoResponse` maps to **500 "Search error"** (`src/error.rs:106-109`). The spec assumed it was a 400. This task makes it one, so bad structured params and bad `q` behave the same way.

**Files:**
- Modify: `src/indexer/search.rs` (the `parse_query` `map_err` in `search_with`)
- Test: `mod filter_tests`

- [ ] **Step 1: Write the failing test**

Append inside `mod filter_tests`:

```rust
    #[test]
    fn malformed_query_is_a_validation_error() {
        let f = corpus();
        let err = f
            .index
            .search_with(
                &query("nosuchfield:pasta", None),
                &SearchFilters::default(),
                SortOrder::Relevance,
                100,
            )
            .unwrap_err();
        assert!(
            matches!(&err, Error::Validation(message) if message.contains("Invalid query")),
            "unexpected error: {err:?}"
        );
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib malformed_query_is_a_validation_error`
Expected: FAIL with `unexpected error: Search("Invalid query: ...")`.

- [ ] **Step 3: Implement**

In `search_with`, change

```rust
                .map_err(|e| Error::Search(format!("Invalid query: {e}")))?
```

to

```rust
                .map_err(|e| Error::Validation(format!("Invalid query: {e}")))?
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib search`
Expected: all ok.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/indexer/search.rs
git commit -m "Report malformed search queries as 400 instead of 500"
```

---

### Task 9: `FilterParams`: parse query-string filters

**Files:**
- Create: `src/api/filters.rs`
- Modify: `src/api/mod.rs:4-6`

- [ ] **Step 1: Write the failing tests**

Create `src/api/filters.rs` with only the tests and a stub import so it compiles as far as the missing type:

```rust
//! Structured-filter query parameters shared by `GET /api/search` and the
//! website search form.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;
    use crate::indexer::filters::SortOrder;

    #[test]
    fn lists_are_trimmed_and_empty_items_dropped() {
        let (filters, _) = FilterParams {
            tags: Some(" vegan, ,Dessert ,".into()),
            include_ingredients: Some("garlic,lemon".into()),
            exclude_ingredients: Some(",".into()),
            ..FilterParams::default()
        }
        .parse()
        .unwrap();
        assert_eq!(filters.tags, vec!["vegan", "Dessert"]);
        assert_eq!(filters.include_ingredients, vec!["garlic", "lemon"]);
        assert!(filters.exclude_ingredients.is_empty());
    }

    #[test]
    fn empty_values_mean_no_filter() {
        let (filters, sort) = FilterParams {
            tags: Some(String::new()),
            max_time: Some(String::new()),
            min_servings: Some("  ".into()),
            difficulty: Some(String::new()),
            sort: Some(String::new()),
            ..FilterParams::default()
        }
        .parse()
        .unwrap();
        assert!(filters.is_empty());
        assert_eq!(sort, SortOrder::Relevance);
    }

    #[test]
    fn numbers_are_parsed() {
        let (filters, _) = FilterParams {
            max_time: Some("30".into()),
            min_servings: Some("2".into()),
            max_servings: Some(" 6 ".into()),
            feed_id: Some("12".into()),
            ..FilterParams::default()
        }
        .parse()
        .unwrap();
        assert_eq!(filters.max_time, Some(30));
        assert_eq!(filters.min_servings, Some(2));
        assert_eq!(filters.max_servings, Some(6));
        assert_eq!(filters.feed_id, Some(12));
    }

    #[test]
    fn invalid_numbers_are_rejected_naming_the_parameter() {
        let cases = [
            (
                FilterParams {
                    max_time: Some("soon".into()),
                    ..FilterParams::default()
                },
                "max_time",
            ),
            (
                FilterParams {
                    min_servings: Some("-1".into()),
                    ..FilterParams::default()
                },
                "min_servings",
            ),
            (
                FilterParams {
                    max_servings: Some("2.5".into()),
                    ..FilterParams::default()
                },
                "max_servings",
            ),
            (
                FilterParams {
                    feed_id: Some("abc".into()),
                    ..FilterParams::default()
                },
                "feed_id",
            ),
        ];
        for (params, name) in cases {
            match params.parse() {
                Err(Error::Validation(message)) => {
                    assert!(message.contains(name), "{name}: {message}")
                }
                other => panic!("{name}: expected a validation error, got {other:?}"),
            }
        }
    }

    #[test]
    fn min_servings_above_max_is_rejected() {
        let result = FilterParams {
            min_servings: Some("6".into()),
            max_servings: Some("2".into()),
            ..FilterParams::default()
        }
        .parse();
        assert!(matches!(result, Err(Error::Validation(_))));
    }

    #[test]
    fn sort_and_difficulty_are_normalised() {
        let (filters, sort) = FilterParams {
            difficulty: Some(" Easy ".into()),
            sort: Some("Newest".into()),
            ..FilterParams::default()
        }
        .parse()
        .unwrap();
        assert_eq!(filters.difficulty.as_deref(), Some("easy"));
        assert_eq!(sort, SortOrder::Newest);

        let result = FilterParams {
            sort: Some("rating".into()),
            ..FilterParams::default()
        }
        .parse();
        assert!(
            matches!(result, Err(Error::Validation(ref m)) if m.contains("sort")),
            "{result:?}"
        );
    }

    #[test]
    fn query_pairs_keep_order_and_skip_empty_values() {
        let params = FilterParams {
            tags: Some("vegan".into()),
            max_time: Some(String::new()),
            sort: Some("newest".into()),
            ..FilterParams::default()
        };
        assert_eq!(
            params.query_pairs(),
            vec![("tags", "vegan"), ("sort", "newest")]
        );
    }
}
```

Replace `src/api/mod.rs` module list (lines 4-6) with:

```rust
pub mod filters;
pub mod handlers;
pub mod models;
pub mod routes;
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib api::filters`
Expected: compile error `cannot find struct, variant or union type `FilterParams` in this scope`.

- [ ] **Step 3: Implement**

Insert above `#[cfg(test)]` in `src/api/filters.rs`:

```rust
use serde::Deserialize;

use crate::error::{Error, Result};
use crate::indexer::filters::{normalize_difficulty, SearchFilters, SortOrder};

/// Structured-filter query parameters. Values arrive as strings, so an empty
/// form field means "no filter" and a malformed number becomes a 400 with a
/// JSON message instead of axum's plain-text query rejection.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct FilterParams {
    /// Comma-separated; the recipe has all of them.
    #[serde(default)]
    pub tags: Option<String>,
    /// Comma-separated; the recipe uses all of them.
    #[serde(default)]
    pub include_ingredients: Option<String>,
    /// Comma-separated; the recipe uses none of them.
    #[serde(default)]
    pub exclude_ingredients: Option<String>,
    /// Minutes.
    #[serde(default)]
    pub max_time: Option<String>,
    #[serde(default)]
    pub min_servings: Option<String>,
    #[serde(default)]
    pub max_servings: Option<String>,
    #[serde(default)]
    pub difficulty: Option<String>,
    #[serde(default)]
    pub feed_id: Option<String>,
    /// `relevance` (default) or `newest`.
    #[serde(default)]
    pub sort: Option<String>,
}

impl FilterParams {
    /// Validate and convert to search filters and an order.
    pub fn parse(&self) -> Result<(SearchFilters, SortOrder)> {
        let filters = SearchFilters {
            tags: split_list(self.tags.as_deref()),
            include_ingredients: split_list(self.include_ingredients.as_deref()),
            exclude_ingredients: split_list(self.exclude_ingredients.as_deref()),
            max_time: parse_count("max_time", self.max_time.as_deref())?,
            min_servings: parse_count("min_servings", self.min_servings.as_deref())?,
            max_servings: parse_count("max_servings", self.max_servings.as_deref())?,
            difficulty: non_empty(self.difficulty.as_deref()).map(normalize_difficulty),
            feed_id: parse_count("feed_id", self.feed_id.as_deref())?,
        };

        if let (Some(min), Some(max)) = (filters.min_servings, filters.max_servings) {
            if min > max {
                return Err(Error::Validation(format!(
                    "min_servings ({min}) must not be greater than max_servings ({max})"
                )));
            }
        }

        let sort = match non_empty(self.sort.as_deref())
            .map(str::to_lowercase)
            .as_deref()
        {
            None | Some("relevance") => SortOrder::Relevance,
            Some("newest") => SortOrder::Newest,
            Some(other) => {
                return Err(Error::Validation(format!(
                    "sort must be \"relevance\" or \"newest\", got \"{other}\""
                )))
            }
        };

        Ok((filters, sort))
    }

    /// The populated parameters as `(name, value)` pairs in a fixed order, for
    /// building links that keep the current filters (pagination).
    pub fn query_pairs(&self) -> Vec<(&'static str, &str)> {
        [
            ("tags", &self.tags),
            ("include_ingredients", &self.include_ingredients),
            ("exclude_ingredients", &self.exclude_ingredients),
            ("max_time", &self.max_time),
            ("min_servings", &self.min_servings),
            ("max_servings", &self.max_servings),
            ("difficulty", &self.difficulty),
            ("feed_id", &self.feed_id),
            ("sort", &self.sort),
        ]
        .into_iter()
        .filter_map(|(name, value)| non_empty(value.as_deref()).map(|value| (name, value)))
        .collect()
    }
}

/// `Some(trimmed)` unless the value is missing or blank.
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// Comma-separated list, items trimmed, empty items dropped.
fn split_list(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

/// A non-negative whole number, or `None` when blank.
fn parse_count(name: &str, value: Option<&str>) -> Result<Option<i64>> {
    let Some(raw) = non_empty(value) else {
        return Ok(None);
    };
    match raw.parse::<i64>() {
        Ok(number) if number >= 0 => Ok(Some(number)),
        _ => Err(Error::Validation(format!(
            "{name} must be a non-negative whole number, got \"{raw}\""
        ))),
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib api::filters`
Expected: `ok. 7 passed`.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/api/filters.rs src/api/mod.rs
git commit -m "Parse structured search filters from query parameters"
```

---

### Task 10: Wire filters, sort and rich cards into `GET /api/search`

**Files:**
- Modify: `src/api/models.rs:1-40` (`SearchParams`, `RecipeCard`, new `CardFeed`)
- Modify: `src/api/handlers.rs:19-66` (`search_recipes`)
- Test: `src/api/routes.rs` `mod tests` (after `test_search_locale_filter_and_recipe_detail_expose_locale`)

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests` in `src/api/routes.rs`:

```rust
    /// Two indexed English recipes in one feed:
    /// "Quick Garlic Pasta" (20 min, serves 2, tags dinner+quick) and
    /// "Slow Garlic Stew" (180 min, serves 6, tag dinner). Returns their ids.
    async fn seed_search_fixture(state: &AppState) -> (i64, i64) {
        use crate::db::models::{NewFeed, NewRecipe};
        use crate::db::{feeds, recipes, tags};
        use crate::indexer::extras::IndexExtras;

        let feed = feeds::create_feed(
            &state.pool,
            &NewFeed {
                url: "https://example.com/filters.xml".to_string(),
                title: Some("Filter Feed".to_string()),
            },
        )
        .await
        .unwrap();

        let make = |external_id: &str, title: &str, total_time: i64, servings: i64| NewRecipe {
            feed_id: feed.id,
            external_id: external_id.to_string(),
            title: title.to_string(),
            source_url: None,
            enclosure_url: format!("https://example.com/{external_id}.cook"),
            content: None,
            summary: Some(format!("{title} summary")),
            servings: Some(servings),
            total_time_minutes: Some(total_time),
            active_time_minutes: None,
            difficulty: Some("easy".to_string()),
            image_url: Some(format!("https://example.com/{external_id}.jpg")),
            published_at: None,
            content_hash: None,
            content_etag: None,
            content_last_modified: None,
            feed_entry_updated: None,
            locale: Some("en".to_string()),
            locale_source: Some("declared".to_string()),
        };

        let quick = recipes::create_recipe(&state.pool, &make("quick", "Quick Garlic Pasta", 20, 2))
            .await
            .unwrap();
        let slow = recipes::create_recipe(&state.pool, &make("slow", "Slow Garlic Stew", 180, 6))
            .await
            .unwrap();
        tags::set_recipe_tags(&state.pool, quick.id, &["dinner".into(), "quick".into()])
            .await
            .unwrap();
        tags::set_recipe_tags(&state.pool, slow.id, &["dinner".into()])
            .await
            .unwrap();

        let mut writer = state.search_index.writer().unwrap();
        for recipe in [&quick, &slow] {
            let extras = IndexExtras {
                file_path: None,
                tags: tags::get_tags_for_recipe(&state.pool, recipe.id).await.unwrap(),
                ingredients: vec!["garlic".to_string()],
                feed_title: Some("Filter Feed".to_string()),
            };
            state
                .search_index
                .index_recipe_full(&mut writer, recipe, &extras)
                .unwrap();
        }
        state.search_index.commit(&mut writer).unwrap();

        (quick.id, slow.id)
    }

    async fn get_json(state: &AppState, uri: &str) -> (StatusCode, serde_json::Value) {
        let app = create_router(state.clone(), &state.settings);
        let response = app
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        (status, response_json(response).await)
    }

    fn result_ids(json: &serde_json::Value) -> Vec<i64> {
        let mut ids: Vec<i64> = json["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["id"].as_i64().unwrap())
            .collect();
        ids.sort();
        ids
    }

    #[tokio::test]
    async fn search_structured_filters_narrow_results() {
        let (state, _index_dir) = create_test_state().await;
        let (quick, slow) = seed_search_fixture(&state).await;

        let (status, json) = get_json(&state, "/api/search?q=garlic&max_time=30").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result_ids(&json), vec![quick]);

        let (_, json) = get_json(&state, "/api/search?tags=dinner,%20quick").await;
        assert_eq!(result_ids(&json), vec![quick]);

        // Filters and ordinary params (page) deserialize side by side.
        let (_, json) = get_json(&state, "/api/search?min_servings=4&max_servings=8&page=1").await;
        assert_eq!(result_ids(&json), vec![slow]);

        let (_, json) = get_json(
            &state,
            "/api/search?q=garlic&locale=en&exclude_ingredients=garlic",
        )
        .await;
        assert!(result_ids(&json).is_empty());

        let (_, json) = get_json(&state, "/api/search?difficulty=EASY&sort=newest").await;
        assert_eq!(result_ids(&json), vec![quick, slow]);
    }

    #[tokio::test]
    async fn search_cards_carry_rich_fields() {
        let (state, _index_dir) = create_test_state().await;
        let (quick, _) = seed_search_fixture(&state).await;

        let (status, json) = get_json(&state, "/api/search?q=quick").await;
        assert_eq!(status, StatusCode::OK);
        let card = &json["results"][0];
        assert_eq!(card["id"].as_i64().unwrap(), quick);
        assert_eq!(card["total_time_minutes"], 20);
        assert_eq!(card["servings"], 2);
        assert_eq!(card["difficulty"], "easy");
        assert_eq!(card["image_url"], "https://example.com/quick.jpg");
        assert_eq!(card["feed"]["title"], "Filter Feed");
        assert!(card["feed"]["id"].as_i64().is_some());
        assert_eq!(card["tags"], serde_json::json!(["dinner", "quick"]));
        assert_eq!(card["locale"], "en");
    }

    #[tokio::test]
    async fn search_rejects_bad_parameters_with_400() {
        let (state, _index_dir) = create_test_state().await;
        seed_search_fixture(&state).await;

        for (uri, needle) in [
            ("/api/search?max_time=soon", "max_time"),
            ("/api/search?min_servings=-2", "min_servings"),
            ("/api/search?sort=rating", "sort"),
            ("/api/search?q=nosuchfield:pasta", "Invalid query"),
        ] {
            let (status, json) = get_json(&state, uri).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
            assert!(
                json["error"].as_str().unwrap().contains(needle),
                "{uri}: {json}"
            );
        }
    }

    #[tokio::test]
    async fn search_with_zero_limit_does_not_fail() {
        let (state, _index_dir) = create_test_state().await;
        seed_search_fixture(&state).await;

        let (status, json) = get_json(&state, "/api/search?limit=0").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["results"].as_array().unwrap().len(), 1);
        assert_eq!(json["pagination"]["limit"], 1);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib api::routes::tests`
Expected: FAIL. `search_structured_filters_narrow_results` gets both ids for `max_time=30` (filters ignored), `search_cards_carry_rich_fields` finds `card["total_time_minutes"]` null, and `search_rejects_bad_parameters_with_400` gets 200 for `max_time=soon`. The `Invalid query` case already passes after Task 8.

- [ ] **Step 3: Implement**

In `src/api/models.rs`, replace lines 1-15 (imports + `SearchParams`) with:

```rust
use serde::{Deserialize, Serialize};

use crate::api::filters::FilterParams;

/// Search request parameters
#[derive(Debug, Clone, Deserialize)]
pub struct SearchParams {
    #[serde(default)]
    pub q: String, // Unified query string
    /// Optional language filter, e.g. "de".
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default = "default_page")]
    pub page: usize,
    #[serde(default = "default_limit")]
    pub limit: usize,
    /// Structured filters and sort order (`tags`, `max_time`, `sort`, ...).
    #[serde(flatten)]
    pub filters: FilterParams,
}
```

Replace the `RecipeCard` struct with:

```rust
/// Recipe card for search results. Everything except `id`, `title` and `tags`
/// may be null; clients must render without it.
#[derive(Debug, Clone, Serialize)]
pub struct RecipeCard {
    pub id: i64,
    pub title: String,
    pub summary: Option<String>,
    pub tags: Vec<String>,
    pub locale: Option<String>,
    pub total_time_minutes: Option<i64>,
    pub servings: Option<i64>,
    pub difficulty: Option<String>,
    pub image_url: Option<String>,
    pub feed: Option<CardFeed>,
}

/// The feed a result card came from.
#[derive(Debug, Clone, Serialize)]
pub struct CardFeed {
    pub id: i64,
    pub title: Option<String>,
}
```

In `src/api/handlers.rs`, replace `search_recipes` (lines 19-66) with:

```rust
/// GET /api/search - Search recipes
pub async fn search_recipes(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResponse>> {
    debug!("Search request: {:?}", params);

    let (filters, sort) = params.filters.parse()?;

    // Build search query
    let query = SearchQuery {
        q: params.q,
        page: params.page.max(1),
        limit: params
            .limit
            .min(state.settings.pagination.api_max_limit)
            .max(1),
        locale: params.locale,
    };

    // Execute search
    let results = state.search_index.search_with(
        &query,
        &filters,
        sort,
        state.settings.pagination.max_search_results,
    )?;

    // Batch fetch tags for all recipes (avoid N+1 query problem)
    let recipe_ids: Vec<i64> = results.results.iter().map(|r| r.recipe_id).collect();
    let tags_map = db::tags::get_tags_for_recipes(&state.pool, &recipe_ids).await?;

    // Card fields come from the stored search document; no per-hit DB lookup.
    let recipe_cards = results
        .results
        .into_iter()
        .map(|result| RecipeCard {
            id: result.recipe_id,
            tags: tags_map.get(&result.recipe_id).cloned().unwrap_or_default(),
            title: result.title,
            summary: result.summary,
            locale: result.locale,
            total_time_minutes: result.total_time_minutes,
            servings: result.servings,
            difficulty: result.difficulty,
            image_url: result.image_url,
            feed: result.feed_id.map(|id| CardFeed {
                id,
                title: result.feed_title,
            }),
        })
        .collect();

    Ok(Json(SearchResponse {
        results: recipe_cards,
        pagination: Pagination {
            page: results.page,
            limit: query.limit,
            total: results.total,
            total_pages: results.total_pages,
        },
    }))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib api::routes::tests`
Expected: `ok. 6 passed`.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/api/models.rs src/api/handlers.rs src/api/routes.rs
git commit -m "Add structured filters, sort and rich cards to /api/search"
```

---

### Task 11: Writer gate, `IndexExtras::load`, `reindex_recipes`, tags regression

**Files:**
- Modify: `src/indexer/search.rs` (`SearchIndex` struct lines 14-18, `new()` `Ok(Self {...})`, new `LockedWriter` + `locked_writer`)
- Modify: `src/indexer/extras.rs` (whole file)
- Create: `tests/search_index_tags_test.rs`

- [ ] **Step 1: Write the failing tests**

Create `tests/search_index_tags_test.rs`:

```rust
//! Tags stored in the database must be searchable both through the `tags:`
//! query syntax and through the structured `tags` filter, for every recipe
//! that goes through the shared indexing path.

use std::sync::Arc;

use federation::db::models::{NewFeed, NewRecipe};
use federation::db::{self, feeds, recipes, tags, DbPool};
use federation::indexer::extras::reindex_recipes;
use federation::indexer::filters::{SearchFilters, SortOrder};
use federation::indexer::{SearchIndex, SearchQuery};

async fn pool() -> DbPool {
    let pool = db::init_pool("sqlite::memory:").await.unwrap();
    db::run_migrations(&pool).await.unwrap();
    pool
}

/// A feed titled "Jane's Kitchen" with one recipe tagged Desserts + chocolate.
async fn seed(pool: &DbPool) -> i64 {
    let feed = feeds::create_feed(
        pool,
        &NewFeed {
            url: "https://example.com/feed.xml".to_string(),
            title: Some("Jane's Kitchen".to_string()),
        },
    )
    .await
    .unwrap();

    let recipe = recipes::create_recipe(
        pool,
        &NewRecipe {
            feed_id: feed.id,
            external_id: "brownies".to_string(),
            title: "Brownies".to_string(),
            source_url: None,
            enclosure_url: "https://example.com/brownies.cook".to_string(),
            content: Some("Melt the @chocolate{200%g}.".to_string()),
            summary: None,
            servings: None,
            total_time_minutes: None,
            active_time_minutes: None,
            difficulty: None,
            image_url: None,
            published_at: None,
            content_hash: None,
            content_etag: None,
            content_last_modified: None,
            feed_entry_updated: None,
            locale: None,
            locale_source: None,
        },
    )
    .await
    .unwrap();

    tags::set_recipe_tags(
        pool,
        recipe.id,
        &["Desserts".to_string(), "chocolate".to_string()],
    )
    .await
    .unwrap();

    recipe.id
}

fn everything() -> SearchQuery {
    SearchQuery {
        q: String::new(),
        page: 1,
        limit: 10,
        locale: None,
    }
}

fn ids(index: &SearchIndex, query: &SearchQuery, filters: &SearchFilters) -> Vec<i64> {
    index
        .search_with(query, filters, SortOrder::Relevance, 100)
        .unwrap()
        .results
        .iter()
        .map(|r| r.recipe_id)
        .collect()
}

fn dessert_filter() -> SearchFilters {
    SearchFilters {
        tags: vec!["dessert".to_string()],
        ..SearchFilters::default()
    }
}

#[tokio::test]
async fn database_tags_are_found_by_tags_query_and_tags_filter() {
    let pool = pool().await;
    let recipe_id = seed(&pool).await;
    let dir = tempfile::tempdir().unwrap();
    let index = SearchIndex::new(dir.path()).unwrap();

    let indexed = reindex_recipes(&pool, &index, &[recipe_id]).await.unwrap();
    assert_eq!(indexed, 1);

    let by_query = SearchQuery {
        q: "tags:dessert".to_string(),
        ..everything()
    };
    assert_eq!(ids(&index, &by_query, &SearchFilters::default()), vec![recipe_id]);
    assert_eq!(ids(&index, &everything(), &dessert_filter()), vec![recipe_id]);

    let card = index
        .search_with(&everything(), &dessert_filter(), SortOrder::Relevance, 100)
        .unwrap()
        .results
        .remove(0);
    assert_eq!(card.feed_title.as_deref(), Some("Jane's Kitchen"));
}

#[tokio::test]
async fn reindexing_nothing_is_a_no_op() {
    let pool = pool().await;
    let dir = tempfile::tempdir().unwrap();
    let index = SearchIndex::new(dir.path()).unwrap();
    assert_eq!(reindex_recipes(&pool, &index, &[]).await.unwrap(), 0);
}

#[tokio::test]
async fn locked_writers_are_handed_out_one_at_a_time() {
    let dir = tempfile::tempdir().unwrap();
    let index = Arc::new(SearchIndex::new(dir.path()).unwrap());

    let first = index.locked_writer().await.unwrap();
    let second = {
        let index = index.clone();
        tokio::spawn(async move { index.locked_writer().await.map(|_| ()) })
    };

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(
        !second.is_finished(),
        "a second writer must wait for the first instead of failing on the index lock"
    );

    drop(first);
    second.await.unwrap().unwrap();
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --test search_index_tags_test`
Expected: compile errors `unresolved import `federation::indexer::extras::reindex_recipes`` and `no method named `locked_writer``.

- [ ] **Step 3: Implement**

In `src/indexer/search.rs`, replace the `SearchIndex` struct with:

```rust
pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    schema: RecipeSchema,
    /// Serialises writers inside this process. Tantivy allows one writer per
    /// index; without this gate a second caller (crawler vs GitHub indexer)
    /// fails with a lock error instead of waiting its turn.
    writer_gate: tokio::sync::Mutex<()>,
}

/// An index writer that holds the in-process writer gate until dropped.
/// Derefs to [`IndexWriter`], so `&mut locked` can be passed wherever
/// `&mut IndexWriter` is expected.
pub struct LockedWriter<'a> {
    // Declared first: fields drop in order, so the writer (and Tantivy's lock
    // file) is released before the gate lets the next writer in.
    writer: IndexWriter,
    _gate: tokio::sync::MutexGuard<'a, ()>,
}

impl std::ops::Deref for LockedWriter<'_> {
    type Target = IndexWriter;

    fn deref(&self) -> &IndexWriter {
        &self.writer
    }
}

impl std::ops::DerefMut for LockedWriter<'_> {
    fn deref_mut(&mut self) -> &mut IndexWriter {
        &mut self.writer
    }
}
```

In `SearchIndex::new`, replace the final `Ok(Self { index, reader, schema, })` with:

```rust
        Ok(Self {
            index,
            reader,
            schema,
            writer_gate: tokio::sync::Mutex::new(()),
        })
```

Add after the `writer()` method:

```rust
    /// Get an index writer, waiting for any other writer in this process to
    /// finish. Long-running server tasks (crawler, GitHub indexer) must use
    /// this; one-shot CLI commands may use [`Self::writer`] directly.
    pub async fn locked_writer(&self) -> Result<LockedWriter<'_>> {
        let gate = self.writer_gate.lock().await;
        let writer = self.writer()?;
        Ok(LockedWriter {
            writer,
            _gate: gate,
        })
    }
```

Replace `src/indexer/extras.rs` entirely with:

```rust
//! Inputs to a search document that live outside the `recipes` row, and the
//! shared "load everything and (re)index these recipes" path.

use crate::db::{self, models::Recipe, DbPool};
use crate::error::{Error, Result};
use crate::indexer::search::SearchIndex;

/// Everything indexed alongside a recipe row that comes from other tables:
/// its GitHub file path, tag and ingredient names, and its feed's title.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IndexExtras {
    pub file_path: Option<String>,
    pub tags: Vec<String>,
    pub ingredients: Vec<String>,
    pub feed_title: Option<String>,
}

impl IndexExtras {
    /// Load a recipe's extras from the database.
    pub async fn load(pool: &DbPool, recipe: &Recipe) -> Result<Self> {
        let file_path = db::github::get_github_recipe_by_recipe_id(pool, recipe.id)
            .await?
            .map(|github_recipe| github_recipe.file_path);
        let tags = db::tags::get_tags_for_recipe(pool, recipe.id).await?;
        let ingredients = db::ingredients::get_ingredients_for_recipe(pool, recipe.id)
            .await?
            .into_iter()
            .map(|ingredient| ingredient.name)
            .collect();
        let feed_title = match db::feeds::get_feed(pool, recipe.feed_id).await {
            Ok(feed) => feed.title,
            Err(Error::NotFound(_)) => None,
            Err(e) => return Err(e),
        };

        Ok(Self {
            file_path,
            tags,
            ingredients,
            feed_title,
        })
    }
}

/// (Re)index the given recipes with their tags, ingredients, file path and
/// feed title, then commit once. All database reads happen before the writer
/// is taken, so the writer gate is held only for the index writes.
/// Returns the number of recipes indexed.
pub async fn reindex_recipes(
    pool: &DbPool,
    search_index: &SearchIndex,
    recipe_ids: &[i64],
) -> Result<usize> {
    if recipe_ids.is_empty() {
        return Ok(0);
    }

    let mut documents = Vec::with_capacity(recipe_ids.len());
    for &recipe_id in recipe_ids {
        let recipe = db::recipes::get_recipe(pool, recipe_id).await?;
        let extras = IndexExtras::load(pool, &recipe).await?;
        documents.push((recipe, extras));
    }

    let mut writer = search_index.locked_writer().await?;
    for (recipe, extras) in &documents {
        search_index.index_recipe_full(&mut writer, recipe, extras)?;
    }
    search_index.commit(&mut writer)?;

    Ok(documents.len())
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --test search_index_tags_test`
Expected: `ok. 3 passed`.
Run: `cargo test 2>&1 | grep -E "^test result|FAILED"`
Expected: all ok.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/indexer/search.rs src/indexer/extras.rs tests/search_index_tags_test.rs
git commit -m "Add shared reindex path with DB tags and an in-process writer gate"
```

---

### Task 12: Every production indexing path loads DB extras

`backfill-locales --force` is the full-rebuild path (see Task 18), so it must write feed titles too. Today it, `cleanup` and the GitHub indexer each re-implement the tag and ingredient loading and never set a feed title.

**Files:**
- Modify: `src/github/indexer.rs:229-285` (stale deletion + batch indexing), `:521-534` (`remove_repository`)
- Modify: `src/cli/commands.rs:491-507` (backfill), `:633-646` (cleanup)
- Test: `tests/search_index_tags_test.rs`, `tests/github_indexer_test.rs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/search_index_tags_test.rs`:

```rust
#[tokio::test]
async fn rebuilding_with_backfill_indexes_tags_and_feed_titles() {
    let pool = pool().await;
    let recipe_id = seed(&pool).await;
    let dir = tempfile::tempdir().unwrap();
    let index = SearchIndex::new(dir.path()).unwrap();

    let stats = federation::cli::commands::backfill_locales(&pool, &index, true)
        .await
        .unwrap();
    assert_eq!(stats.scanned, 1);

    let results = index
        .search_with(&everything(), &dessert_filter(), SortOrder::Relevance, 100)
        .unwrap();
    assert_eq!(results.results.len(), 1);
    assert_eq!(results.results[0].recipe_id, recipe_id);
    assert_eq!(
        results.results[0].feed_title.as_deref(),
        Some("Jane's Kitchen"),
        "a rebuild must fill the card's feed title"
    );
}
```

Append to `tests/github_indexer_test.rs`:

```rust
#[tokio::test]
async fn indexed_recipes_carry_tags_and_feed_title() {
    use federation::indexer::filters::{SearchFilters, SortOrder};

    let h = Harness::new().await;
    let mut repo = FakeRepo::new("alice", "recipes").await;
    repo.set_files(&[(
        "Brownies.cook",
        "---\ntags: [desserts, chocolate]\n---\nMelt @chocolate{200%g}.\n",
    )])
    .await;
    h.indexer(&repo).add_repository(&repo.url()).await.unwrap();

    let query = SearchQuery {
        q: String::new(),
        page: 1,
        limit: 10,
        locale: None,
    };
    let filters = SearchFilters {
        tags: vec!["dessert".to_string()],
        ..SearchFilters::default()
    };
    let results = h
        .search
        .search_with(&query, &filters, SortOrder::Relevance, 100)
        .unwrap();

    assert_eq!(results.results.len(), 1);
    // The fake repository has no description, so the feed is titled by its full name.
    assert_eq!(results.results[0].feed_title.as_deref(), Some("alice/recipes"));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --test search_index_tags_test rebuilding && cargo test --test github_indexer_test indexed_recipes_carry`
Expected: both FAIL on the feed-title assertion (`left: None`, `right: Some(...)`). The tag assertions already pass, because these paths already load DB tags.

- [ ] **Step 3: Implement**

`src/github/indexer.rs`: replace the block from `// Batch commit to search index` (line 237) through the closing `}` of `if !successful_recipe_ids.is_empty() || !stale.is_empty() { ... }` (line 285) with:

```rust
        // Files that left the repository leave the index and the database.
        if !stale.is_empty() {
            let mut search_writer = self.search_index.locked_writer().await?;

            for github_recipe in &stale {
                info!(
                    "Removing {}/{}:{}: no longer in the repository",
                    github_feed.owner, github_feed.repo_name, github_recipe.file_path
                );
                self.search_index
                    .delete_recipe(&mut search_writer, github_recipe.recipe_id)?;
                db::recipes::delete_recipe(&self.pool, github_recipe.recipe_id).await?;
            }

            self.search_index.commit(&mut search_writer)?;
        }

        // Every recipe still in the repository is (re)indexed with its tags,
        // ingredients, file path and feed title, with a single commit.
        crate::indexer::extras::reindex_recipes(
            &self.pool,
            &self.search_index,
            &successful_recipe_ids,
        )
        .await?;
```

In `remove_repository`, replace

```rust
        let mut writer = self.search_index.writer()?;
```

with

```rust
        let mut writer = self.search_index.locked_writer().await?;
```

and replace `        writer.commit()?;` with

```rust
        self.search_index.commit(&mut writer)?;
```

`src/cli/commands.rs`, in `backfill_locales`: replace lines 491-507 (from `let file_path = crate::db::github::get_github_recipe_by_recipe_id` through the `search_index.index_recipe(...)?;` call) with:

```rust
            let extras = crate::indexer::extras::IndexExtras::load(pool, &recipe).await?;
            search_index.index_recipe_full(&mut writer, &recipe, &extras)?;
```

In `cleanup_recipes`: replace lines 633-646 (from `let recipe = crate::db::recipes::get_recipe(pool, recipe.id).await?;` through the `search_index.index_recipe(...)?;` call) with:

```rust
        let recipe = crate::db::recipes::get_recipe(pool, recipe.id).await?;
        let extras = crate::indexer::extras::IndexExtras::load(pool, &recipe).await?;
        search_index.index_recipe_full(&mut writer, &recipe, &extras)?;
```

(`IndexExtras::load` reads the file path from `github_recipes`, so this is what `cleanup` passed before.)

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --test search_index_tags_test && cargo test --test github_indexer_test && cargo test --test cleanup_test`
Expected: all ok. The existing GitHub tests (stale removal, refresh, dedup) still pass.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/github/indexer.rs src/cli/commands.rs tests/search_index_tags_test.rs tests/github_indexer_test.rs
git commit -m "Index GitHub, backfill and cleanup recipes through the shared extras loader"
```

---

### Task 13: The crawler keeps the index in step (feed recipes and their tags)

The spec lists "crawler" as an `index_recipe` call site. There is no such call: `Crawler` never touches Tantivy. RSS/Atom recipes, and the tags that come from `<category>`, reach the search index only when someone runs `backfill-locales`. This task makes the crawler index what it creates or updates.

**Files:**
- Modify: `src/crawler/mod.rs:8-19` (imports), `:20-28` (`ProcessResult`), `:31-47` (struct/new), `:167-178` (entry loop), `:380-437` (results), tests module
- Modify: `src/main.rs:137-159`

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests` in `src/crawler/mod.rs`:

```rust
    fn test_config() -> CrawlerConfig {
        CrawlerConfig {
            interval_seconds: 3600,
            max_feed_size: 5_242_880,
            max_recipe_size: 1_048_576,
            rate_limit: 1,
            user_agent: "TestBot/1.0".to_string(),
        }
    }

    async fn seeded_pool() -> (DbPool, i64) {
        use crate::db::models::{NewFeed, NewRecipe};

        let pool = crate::db::init_pool("sqlite::memory:").await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        let feed = db::feeds::create_feed(
            &pool,
            &NewFeed {
                url: "https://example.com/feed.xml".to_string(),
                title: Some("Jane's Kitchen".to_string()),
            },
        )
        .await
        .unwrap();
        let recipe = db::recipes::create_recipe(
            &pool,
            &NewRecipe {
                feed_id: feed.id,
                external_id: "cookies".to_string(),
                title: "Chocolate Chip Cookies".to_string(),
                source_url: None,
                enclosure_url: "https://example.com/cookies.cook".to_string(),
                content: Some("Mix @flour{250%g}.".to_string()),
                summary: None,
                servings: Some(24),
                total_time_minutes: Some(45),
                active_time_minutes: None,
                difficulty: Some("easy".to_string()),
                image_url: None,
                published_at: None,
                content_hash: None,
                content_etag: None,
                content_last_modified: None,
                feed_entry_updated: None,
                locale: None,
                locale_source: None,
            },
        )
        .await
        .unwrap();
        db::tags::add_recipe_tags(&pool, recipe.id, &["dessert".to_string()])
            .await
            .unwrap();
        (pool, recipe.id)
    }

    #[tokio::test]
    async fn changed_recipes_are_indexed_with_their_tags() {
        use crate::indexer::filters::{SearchFilters, SortOrder};
        use crate::indexer::{SearchIndex, SearchQuery};

        let (pool, recipe_id) = seeded_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let index = Arc::new(SearchIndex::new(dir.path()).unwrap());
        let crawler = Crawler::new(test_config())
            .unwrap()
            .with_search_index(index.clone());

        crawler.index_changed_recipes(&pool, &[recipe_id]).await;

        let results = index
            .search_with(
                &SearchQuery {
                    q: String::new(),
                    page: 1,
                    limit: 10,
                    locale: None,
                },
                &SearchFilters {
                    tags: vec!["dessert".to_string()],
                    max_time: Some(60),
                    ..SearchFilters::default()
                },
                SortOrder::Relevance,
                100,
            )
            .unwrap();
        assert_eq!(results.results.len(), 1);
        assert_eq!(results.results[0].recipe_id, recipe_id);
        assert_eq!(results.results[0].feed_title.as_deref(), Some("Jane's Kitchen"));
    }

    #[tokio::test]
    async fn without_a_search_index_changed_recipes_are_left_alone() {
        let (pool, recipe_id) = seeded_pool().await;
        let crawler = Crawler::new(test_config()).unwrap();
        // Must neither panic nor error: CLI crawls run without an index.
        crawler.index_changed_recipes(&pool, &[recipe_id]).await;
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib crawler::tests`
Expected: compile errors `no method named `with_search_index`` and `no method named `index_changed_recipes``.

- [ ] **Step 3: Implement**

In `src/crawler/mod.rs`, add to the imports (after `use crate::indexer::parse_cooklang_full;`):

```rust
use crate::indexer::extras::reindex_recipes;
use crate::indexer::search::SearchIndex;
```

Replace `ProcessResult` (lines 20-28) with:

```rust
/// Result of processing a single feed entry
#[derive(Debug)]
enum ProcessResult {
    /// New recipe was created
    New(i64),
    /// Existing recipe was updated
    Updated(i64),
    /// Recipe was skipped (no changes detected)
    Skipped,
}
```

Replace the `Crawler` struct and `new` (lines 31-47) with:

```rust
/// Main crawler that orchestrates feed fetching and parsing
pub struct Crawler {
    fetcher: Fetcher,
    rate_limiters: Arc<Mutex<HashMap<String, Arc<RateLimiter>>>>,
    config: CrawlerConfig,
    /// When set, recipes a crawl creates or updates are (re)indexed at the end
    /// of that feed's crawl. CLI crawls leave it unset.
    search_index: Option<Arc<SearchIndex>>,
}

impl Crawler {
    pub fn new(config: CrawlerConfig) -> Result<Self> {
        let fetcher = Fetcher::new(config.user_agent.clone(), config.max_feed_size)?;

        Ok(Self {
            fetcher,
            rate_limiters: Arc::new(Mutex::new(HashMap::new())),
            config,
            search_index: None,
        })
    }

    /// Keep this search index in step with every crawl.
    pub fn with_search_index(mut self, search_index: Arc<SearchIndex>) -> Self {
        self.search_index = Some(search_index);
        self
    }

    /// (Re)index recipes this crawl created or updated, with their tags. A
    /// failure is logged, not returned: the database is already up to date,
    /// and the next change or a `backfill-locales` run re-indexes the recipe.
    async fn index_changed_recipes(&self, pool: &DbPool, recipe_ids: &[i64]) {
        let Some(search_index) = &self.search_index else {
            return;
        };

        match reindex_recipes(pool, search_index, recipe_ids).await {
            Ok(count) => debug!("Indexed {} changed recipes", count),
            Err(e) => warn!(
                "Failed to update the search index for {} recipes: {}",
                recipe_ids.len(),
                e
            ),
        }
    }
```

(`impl Crawler {` now opens here, so delete the original `impl Crawler {` line together with the old `new`.)

Replace the entry loop in `crawl_feed` (lines 167-178, `for entry in parsed_feed.entries { ... }`) with:

```rust
        let mut changed_recipe_ids = Vec::new();

        for entry in parsed_feed.entries {
            match self.process_entry(pool, feed.id, &entry).await {
                Ok(ProcessResult::New(recipe_id)) => {
                    new_recipes += 1;
                    changed_recipe_ids.push(recipe_id);
                }
                Ok(ProcessResult::Updated(recipe_id)) => {
                    updated_recipes += 1;
                    changed_recipe_ids.push(recipe_id);
                }
                Ok(ProcessResult::Skipped) => skipped_recipes += 1,
                Err(e) => {
                    warn!("Failed to process entry {}: {}", entry.id, e);
                }
            }
        }

        self.index_changed_recipes(pool, &changed_recipe_ids).await;
```

In `process_entry`, change `ProcessResult::Updated` (after `debug!("Updated recipe {}: {}", recipe.id, recipe.title);`) to `ProcessResult::Updated(recipe.id)`, and `ProcessResult::New` (after `debug!("Created new recipe {}: {}", recipe.id, recipe.title);`) to `ProcessResult::New(recipe.id)`.

In `src/main.rs`, replace lines 137-159 (from `// Initialize search index` through `let search_index = Arc::new(search_index);`) with:

```rust
    // Initialize search index
    let index_path = std::path::PathBuf::from(&settings.search.index_path);
    let search_index = Arc::new(SearchIndex::new(&index_path)?);
    info!("Search index initialized at {:?}", index_path);

    // Initialize crawler; it indexes the recipes each crawl creates or updates
    let crawler = Arc::new(
        federation::crawler::Crawler::new(settings.crawler.clone())?
            .with_search_index(search_index.clone()),
    );
    info!("Crawler initialized");

    // Start background scheduler
    let scheduler = Arc::new(federation::crawler::scheduler::Scheduler::new(
        pool.clone(),
        crawler,
        settings.crawler.interval_seconds,
    ));
    let _scheduler_handle = scheduler.start();
    info!(
        "Background scheduler started (interval: {}s)",
        settings.crawler.interval_seconds
    );
```

The `reindex <url>` CLI command (`main.rs:282-304`) keeps a crawler without an index. It runs in a separate process, and Tantivy's cross-process lock would collide with a running server.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib crawler::tests && cargo build`
Expected: tests ok (7 passed); build succeeds.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/crawler/mod.rs src/main.rs
git commit -m "Index crawled feed recipes and their tags as they change"
```

---

### Task 14: Facet queries and a shared language list

**Files:**
- Create: `src/api/facets.rs`
- Modify: `src/api/mod.rs`
- Modify: `src/api/models.rs` (append facet models)
- Modify: `src/db/tags.rs` (append `top_tags` before `#[cfg(test)]`)
- Modify: `src/db/recipes.rs` (append `list_difficulties` after `list_locales`)
- Modify: `src/web/handlers.rs:84-106` (locale dropdown uses `language_facets`)
- Test: `mod tests` in `src/api/facets.rs`

- [ ] **Step 1: Write the failing test**

Create `src/api/facets.rs`:

```rust
//! Facet counts for search filter UIs: tags, languages and difficulties.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{NewFeed, NewRecipe};

    /// en, en-US, de and an unknown-locale recipe; three tagged dessert, two
    /// vegan, one soup; difficulties "Easy", "easy ", "hard" and none.
    async fn seeded_pool() -> DbPool {
        let pool = db::init_pool("sqlite::memory:").await.unwrap();
        db::run_migrations(&pool).await.unwrap();
        let feed = db::feeds::create_feed(
            &pool,
            &NewFeed {
                url: "https://example.com/feed.xml".to_string(),
                title: Some("Feed".to_string()),
            },
        )
        .await
        .unwrap();

        let rows: [(&str, Option<&str>, Option<&str>, &[&str]); 4] = [
            ("a", Some("en"), Some("Easy"), &["dessert", "vegan"]),
            ("b", Some("en-US"), Some("easy "), &["dessert"]),
            ("c", Some("de"), Some("hard"), &["dessert", "vegan"]),
            ("d", None, None, &["soup"]),
        ];
        for (external_id, locale, difficulty, tag_names) in rows {
            let recipe = db::recipes::create_recipe(
                &pool,
                &NewRecipe {
                    feed_id: feed.id,
                    external_id: external_id.to_string(),
                    title: format!("Recipe {external_id}"),
                    source_url: None,
                    enclosure_url: format!("https://example.com/{external_id}.cook"),
                    content: None,
                    summary: None,
                    servings: None,
                    total_time_minutes: None,
                    active_time_minutes: None,
                    difficulty: difficulty.map(str::to_string),
                    image_url: None,
                    published_at: None,
                    content_hash: None,
                    content_etag: None,
                    content_last_modified: None,
                    feed_entry_updated: None,
                    locale: locale.map(str::to_string),
                    locale_source: locale.map(|_| "declared".to_string()),
                },
            )
            .await
            .unwrap();
            let tag_names: Vec<String> = tag_names.iter().map(|t| t.to_string()).collect();
            db::tags::set_recipe_tags(&pool, recipe.id, &tag_names)
                .await
                .unwrap();
        }
        pool
    }

    #[tokio::test]
    async fn facets_count_tags_languages_and_difficulties() {
        let pool = seeded_pool().await;
        let facets = load_facets(&pool).await.unwrap();

        let tags: Vec<(&str, i64)> = facets
            .tags
            .iter()
            .map(|t| (t.name.as_str(), t.count))
            .collect();
        assert_eq!(tags, vec![("dessert", 3), ("vegan", 2), ("soup", 1)]);

        let locales: Vec<(&str, &str, i64)> = facets
            .locales
            .iter()
            .map(|l| (l.code.as_str(), l.name.as_str(), l.count))
            .collect();
        assert_eq!(
            locales,
            vec![("en", "English", 2), ("de", "German", 1)],
            "regional codes fold into their language"
        );

        let difficulties: Vec<(&str, i64)> = facets
            .difficulties
            .iter()
            .map(|d| (d.name.as_str(), d.count))
            .collect();
        assert_eq!(difficulties, vec![("easy", 2), ("hard", 1)]);
    }

    #[tokio::test]
    async fn top_tags_honours_the_limit() {
        let pool = seeded_pool().await;
        let tags = db::tags::top_tags(&pool, 2).await.unwrap();
        assert_eq!(
            tags,
            vec![("dessert".to_string(), 3), ("vegan".to_string(), 2)]
        );
    }
}
```

In `src/api/mod.rs`, add `pub mod facets;` so the list reads:

```rust
pub mod facets;
pub mod filters;
pub mod handlers;
pub mod models;
pub mod routes;
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib api::facets`
Expected: compile errors `cannot find function `load_facets``, `cannot find function `top_tags` in module `db::tags``.

- [ ] **Step 3: Implement**

Append to `src/api/models.rs`:

```rust
/// `GET /api/facets` response
#[derive(Debug, Clone, Default, Serialize)]
pub struct FacetsResponse {
    pub tags: Vec<TagFacet>,
    pub locales: Vec<LocaleFacet>,
    pub difficulties: Vec<DifficultyFacet>,
}

/// A tag and how many recipes carry it
#[derive(Debug, Clone, Serialize)]
pub struct TagFacet {
    pub name: String,
    pub count: i64,
}

/// A language (base code, e.g. "en") with its English name and recipe count
#[derive(Debug, Clone, Serialize)]
pub struct LocaleFacet {
    pub code: String,
    pub name: String,
    pub count: i64,
}

/// A normalised difficulty value and its recipe count
#[derive(Debug, Clone, Serialize)]
pub struct DifficultyFacet {
    pub name: String,
    pub count: i64,
}

/// `GET /api/facets` query parameters
#[derive(Debug, Clone, Deserialize)]
pub struct FacetsParams {
    #[serde(default)]
    pub tag_limit: Option<String>,
}
```

In `src/db/tags.rs`, add before `#[cfg(test)]`:

```rust
/// The `limit` most used tags with their recipe counts, most used first.
/// Tags no recipe uses are left out.
pub async fn top_tags(pool: &DbPool, limit: i64) -> Result<Vec<(String, i64)>> {
    let tags: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT t.name, COUNT(rt.recipe_id) AS count
        FROM tags t
        JOIN recipe_tags rt ON rt.tag_id = t.id
        GROUP BY t.id, t.name
        ORDER BY count DESC, t.name
        LIMIT ?
        "#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(tags)
}
```

In `src/db/recipes.rs`, add directly after `list_locales`:

```rust
/// Distinct difficulty values (trimmed, lowercased, as the search index
/// stores them) with recipe counts, most common first.
pub async fn list_difficulties(pool: &DbPool) -> Result<Vec<(String, i64)>> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT LOWER(TRIM(difficulty)) AS name, COUNT(*) AS count
        FROM recipes
        WHERE difficulty IS NOT NULL AND TRIM(difficulty) <> ''
        GROUP BY LOWER(TRIM(difficulty))
        ORDER BY count DESC, name ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows)
}
```

In `src/api/facets.rs`, insert above `#[cfg(test)]`:

```rust
use crate::api::models::{DifficultyFacet, FacetsResponse, LocaleFacet, TagFacet};
use crate::db::{self, DbPool};
use crate::error::Result;
use crate::indexer::locale::display_name;

/// Tags returned by `GET /api/facets` when `tag_limit` is not given.
pub const DEFAULT_TAG_LIMIT: usize = 200;

/// Largest `tag_limit` a client may ask for.
pub const MAX_TAG_LIMIT: usize = 1000;

/// Recipe counts per language, most common first. Regional codes ("en-US")
/// are folded into their base language ("en"), so each language appears once.
/// This is the list behind the website's language dropdown.
pub async fn language_facets(pool: &DbPool) -> Result<Vec<LocaleFacet>> {
    let mut counts: Vec<(String, i64)> = Vec::new();
    for (code, count) in db::recipes::list_locales(pool).await? {
        let base = code.split('-').next().unwrap_or(&code).to_string();
        match counts.iter_mut().find(|(c, _)| *c == base) {
            Some((_, existing)) => *existing += count,
            None => counts.push((base, count)),
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    Ok(counts
        .into_iter()
        .map(|(code, count)| LocaleFacet {
            name: display_name(&code).unwrap_or_else(|| code.clone()),
            code,
            count,
        })
        .collect())
}

/// Every facet list, with tags capped at [`MAX_TAG_LIMIT`].
pub async fn load_facets(pool: &DbPool) -> Result<FacetsResponse> {
    let tags = db::tags::top_tags(pool, MAX_TAG_LIMIT as i64)
        .await?
        .into_iter()
        .map(|(name, count)| TagFacet { name, count })
        .collect();
    let locales = language_facets(pool).await?;
    let difficulties = db::recipes::list_difficulties(pool)
        .await?
        .into_iter()
        .map(|(name, count)| DifficultyFacet { name, count })
        .collect();

    Ok(FacetsResponse {
        tags,
        locales,
        difficulties,
    })
}
```

In `src/web/handlers.rs`, replace the `let locales = { ... };` block in `index` (lines 84-106) with:

```rust
    // Language filter options: one entry per language, most common first.
    let locales = crate::api::facets::language_facets(&state.pool)
        .await?
        .into_iter()
        .map(|facet| LocaleOption {
            code: facet.code,
            name: facet.name,
            count: facet.count,
        })
        .collect::<Vec<_>>();
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib api::facets && cargo test --lib`
Expected: `ok. 2 passed`, then the whole lib suite ok.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/api/facets.rs src/api/mod.rs src/api/models.rs src/db/tags.rs src/db/recipes.rs src/web/handlers.rs
git commit -m "Add facet queries and share the language list with the website"
```

---

### Task 15: `GET /api/facets` with a 5-minute cache

**Files:**
- Modify: `src/api/facets.rs` (cache + `parse_tag_limit`)
- Modify: `src/api/handlers.rs:10-17` (`AppState`), new `get_facets`
- Modify: `src/api/routes.rs:25-36` (route), `:233-238` (test state)
- Modify: `src/main.rs:192-198` (`AppState` literal)
- Test: `src/api/facets.rs` tests, `src/api/routes.rs` tests

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests` in `src/api/facets.rs`:

```rust
    #[tokio::test]
    async fn cache_serves_the_stored_value_until_it_expires() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let loads = AtomicUsize::new(0);
        let load = || async {
            loads.fetch_add(1, Ordering::SeqCst);
            Ok::<_, crate::error::Error>(FacetsResponse::default())
        };

        let cache = FacetsCache::new(Duration::from_secs(300));
        cache.get_or_load(load).await.unwrap();
        cache.get_or_load(load).await.unwrap();
        assert_eq!(loads.load(Ordering::SeqCst), 1, "second call is served from cache");

        let expired = FacetsCache::new(Duration::ZERO);
        expired.get_or_load(load).await.unwrap();
        expired.get_or_load(load).await.unwrap();
        assert_eq!(loads.load(Ordering::SeqCst), 3, "an expired entry is reloaded");
    }

    #[test]
    fn tag_limit_defaults_caps_and_rejects_garbage() {
        assert_eq!(parse_tag_limit(None).unwrap(), DEFAULT_TAG_LIMIT);
        assert_eq!(parse_tag_limit(Some(" ")).unwrap(), DEFAULT_TAG_LIMIT);
        assert_eq!(parse_tag_limit(Some("5")).unwrap(), 5);
        assert_eq!(parse_tag_limit(Some("5000")).unwrap(), MAX_TAG_LIMIT);
        assert!(parse_tag_limit(Some("0")).is_err());
        assert!(parse_tag_limit(Some("many")).is_err());
    }
```

Append inside `mod tests` in `src/api/routes.rs`:

```rust
    #[tokio::test]
    async fn facets_endpoint_reports_counts_and_honours_tag_limit() {
        let (state, _index_dir) = create_test_state().await;
        seed_search_fixture(&state).await;

        let (status, json) = get_json(&state, "/api/facets").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            json["tags"][0],
            serde_json::json!({ "name": "dinner", "count": 2 })
        );
        assert_eq!(
            json["locales"][0],
            serde_json::json!({ "code": "en", "name": "English", "count": 2 })
        );
        assert_eq!(
            json["difficulties"][0],
            serde_json::json!({ "name": "easy", "count": 2 })
        );

        // Served from the cache (loaded with every tag), then trimmed.
        let (_, limited) = get_json(&state, "/api/facets?tag_limit=1").await;
        assert_eq!(limited["tags"].as_array().unwrap().len(), 1);

        let (status, json) = get_json(&state, "/api/facets?tag_limit=lots").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(json["error"].as_str().unwrap().contains("tag_limit"));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib api::facets api::routes`
Expected: compile errors `cannot find type `FacetsCache``, `cannot find function `parse_tag_limit``. After those compile, `/api/facets` would return 404.

- [ ] **Step 3: Implement**

In `src/api/facets.rs`, extend the imports at the top to:

```rust
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::RwLock;

use crate::api::models::{DifficultyFacet, FacetsResponse, LocaleFacet, TagFacet};
use crate::db::{self, DbPool};
use crate::error::{Error, Result};
use crate::indexer::locale::display_name;
```

and add after `MAX_TAG_LIMIT`:

```rust
/// How long computed facets are served before they are recomputed.
pub const FACETS_TTL: Duration = Duration::from_secs(300);

/// In-memory cache for the facet lists. One entry, holding every list with
/// tags capped at [`MAX_TAG_LIMIT`]; requests trim tags to their own limit.
pub struct FacetsCache {
    ttl: Duration,
    entry: RwLock<Option<(Instant, Arc<FacetsResponse>)>>,
}

impl FacetsCache {
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            entry: RwLock::new(None),
        }
    }

    /// The cached facets while fresh, else the result of `load` (which is then
    /// cached). Concurrent callers on an expired entry load it once.
    pub async fn get_or_load<F, Fut>(&self, load: F) -> Result<Arc<FacetsResponse>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<FacetsResponse>>,
    {
        if let Some((loaded_at, facets)) = self.entry.read().await.as_ref() {
            if loaded_at.elapsed() < self.ttl {
                return Ok(facets.clone());
            }
        }

        let mut entry = self.entry.write().await;
        if let Some((loaded_at, facets)) = entry.as_ref() {
            if loaded_at.elapsed() < self.ttl {
                return Ok(facets.clone());
            }
        }

        let facets = Arc::new(load().await?);
        *entry = Some((Instant::now(), facets.clone()));
        Ok(facets)
    }
}

impl Default for FacetsCache {
    fn default() -> Self {
        Self::new(FACETS_TTL)
    }
}

/// `tag_limit`: blank means [`DEFAULT_TAG_LIMIT`], values above
/// [`MAX_TAG_LIMIT`] are capped, anything but a positive integer is a 400.
pub fn parse_tag_limit(value: Option<&str>) -> Result<usize> {
    let Some(raw) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(DEFAULT_TAG_LIMIT);
    };
    match raw.parse::<usize>() {
        Ok(limit) if limit > 0 => Ok(limit.min(MAX_TAG_LIMIT)),
        _ => Err(Error::Validation(format!(
            "tag_limit must be a positive whole number, got \"{raw}\""
        ))),
    }
}
```

In `src/api/handlers.rs`, replace `AppState` with:

```rust
/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::SqlitePool,
    pub search_index: Arc<crate::indexer::search::SearchIndex>,
    pub github_indexer: Option<crate::github::GitHubIndexer>,
    pub settings: crate::config::Settings,
    pub facets_cache: Arc<crate::api::facets::FacetsCache>,
}
```

and add after `search_recipes`:

```rust
/// GET /api/facets - Tag, language and difficulty counts for filter UIs
pub async fn get_facets(
    State(state): State<AppState>,
    Query(params): Query<FacetsParams>,
) -> Result<Json<FacetsResponse>> {
    debug!("Facets request: {:?}", params);

    let tag_limit = crate::api::facets::parse_tag_limit(params.tag_limit.as_deref())?;
    let pool = state.pool.clone();
    let facets = state
        .facets_cache
        .get_or_load(|| async move { crate::api::facets::load_facets(&pool).await })
        .await?;

    let mut response = (*facets).clone();
    response.tags.truncate(tag_limit);
    Ok(Json(response))
}
```

In `src/api/routes.rs`, add the route after the search route:

```rust
        // Search
        .route("/search", get(api_handlers::search_recipes))
        .route("/facets", get(api_handlers::get_facets))
```

and in `create_test_state` replace the `AppState { ... }` literal with:

```rust
        let state = AppState {
            pool,
            search_index: Arc::new(search_index),
            github_indexer: None,
            settings,
            facets_cache: Arc::new(crate::api::facets::FacetsCache::default()),
        };
```

In `src/main.rs`, replace the `AppState` literal with:

```rust
    let state = AppState {
        pool,
        search_index,
        github_indexer,
        settings: settings.clone(),
        facets_cache: Arc::new(federation::api::facets::FacetsCache::default()),
    };
```

The route sits in `api_routes`, so the `/api` rate limit covers it automatically.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib api:: && cargo build`
Expected: all ok; build succeeds.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/api/facets.rs src/api/handlers.rs src/api/routes.rs src/main.rs
git commit -m "Add GET /api/facets with a five-minute cache"
```

---

### Task 16: Per-client rate limiting

Two bugs make today's limit a single global bucket that is far stricter than configured:
1. The key extractor looks up a bare `SocketAddr` request extension. Axum never sets one (the server is started without connect info, and axum stores `ConnectInfo<SocketAddr>` anyway), so every request is keyed `127.0.0.1`.
2. `GovernorConfigBuilder::per_second(n)` means "replenish **one** request every `n` seconds". With `API_RATE_LIMIT=100`, the whole site gets a burst of 200 and then **one request per 100 s**.

**Files:**
- Create: `src/api/rate_limit.rs`
- Modify: `src/api/mod.rs`
- Modify: `src/api/routes.rs:9-14` (cfg imports), `:38-79` (governor block)
- Modify: `src/main.rs:233-235` (`axum::serve`)

- [ ] **Step 1: Write the failing tests**

Create `src/api/rate_limit.rs`:

```rust
//! Rate-limit key and quota for the public API.

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(forwarded_for: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(value) = forwarded_for {
            headers.insert("x-forwarded-for", HeaderValue::from_str(value).unwrap());
        }
        headers
    }

    fn peer(addr: &str) -> Option<SocketAddr> {
        Some(addr.parse().unwrap())
    }

    fn ip(addr: &str) -> IpAddr {
        addr.parse().unwrap()
    }

    #[test]
    fn direct_clients_are_keyed_by_their_address() {
        assert_eq!(
            client_ip(&headers(None), peer("203.0.113.7:5000")),
            ip("203.0.113.7")
        );
    }

    #[test]
    fn a_public_peer_cannot_choose_its_key_with_a_header() {
        assert_eq!(
            client_ip(&headers(Some("198.51.100.1")), peer("203.0.113.7:5000")),
            ip("203.0.113.7")
        );
    }

    #[test]
    fn behind_a_local_proxy_the_first_forwarded_hop_is_the_key() {
        assert_eq!(
            client_ip(
                &headers(Some("198.51.100.1, 10.0.0.2")),
                peer("127.0.0.1:40000")
            ),
            ip("198.51.100.1")
        );
        assert_eq!(
            client_ip(&headers(Some(" 198.51.100.9 ")), peer("172.18.0.1:40000")),
            ip("198.51.100.9")
        );
        assert_eq!(
            client_ip(&headers(Some("2001:db8::1")), peer("[::1]:40000")),
            ip("2001:db8::1")
        );
    }

    #[test]
    fn a_proxy_without_a_usable_header_is_keyed_by_itself() {
        assert_eq!(
            client_ip(&headers(None), peer("127.0.0.1:40000")),
            ip("127.0.0.1")
        );
        assert_eq!(
            client_ip(&headers(Some("not-an-ip")), peer("10.0.0.5:40000")),
            ip("10.0.0.5")
        );
    }

    #[test]
    fn without_connect_info_the_header_then_localhost_is_used() {
        assert_eq!(
            client_ip(&headers(Some("198.51.100.1")), None),
            ip("198.51.100.1")
        );
        assert_eq!(client_ip(&headers(None), None), ip("127.0.0.1"));
    }

    #[test]
    fn extractor_reads_axum_connect_info() {
        let mut request = Request::builder()
            .uri("/api/search")
            .body(())
            .unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo::<SocketAddr>("203.0.113.7:5000".parse().unwrap()));
        assert_eq!(
            ClientIpKeyExtractor.extract(&request).unwrap(),
            ip("203.0.113.7")
        );
    }

    #[test]
    fn governor_period_spreads_the_rate_over_one_second() {
        assert_eq!(governor_period(100), Duration::from_millis(10));
        assert_eq!(governor_period(1), Duration::from_secs(1));
        assert_eq!(governor_period(0), Duration::from_secs(1));
    }
}
```

In `src/api/mod.rs`, add `pub mod rate_limit;` so the list reads:

```rust
pub mod facets;
pub mod filters;
pub mod handlers;
pub mod models;
pub mod rate_limit;
pub mod routes;
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib api::rate_limit`
Expected: compile errors `cannot find function `client_ip``, `cannot find struct `ClientIpKeyExtractor``.

- [ ] **Step 3: Implement**

Insert above `#[cfg(test)]` in `src/api/rate_limit.rs`:

```rust
use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, Request};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;
use tower_governor::key_extractor::KeyExtractor;
use tower_governor::GovernorError;

/// The address a request is rate-limited by.
///
/// A peer on loopback or a private network is taken to be our reverse proxy:
/// the first `X-Forwarded-For` hop (the original client) is used when present
/// and valid. Any other peer is keyed by its own address, so a client cannot
/// pick its bucket by sending the header. Without connection info (tests, or
/// a server started without it) the header is used, then localhost.
pub fn client_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> IpAddr {
    match peer {
        Some(addr) if is_proxy(addr.ip()) => forwarded_for(headers).unwrap_or(addr.ip()),
        Some(addr) => addr.ip(),
        None => forwarded_for(headers).unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST)),
    }
}

/// First hop of `X-Forwarded-For`, if it parses as an IP address.
fn forwarded_for(headers: &HeaderMap) -> Option<IpAddr> {
    headers
        .get("x-forwarded-for")?
        .to_str()
        .ok()?
        .split(',')
        .next()?
        .trim()
        .parse()
        .ok()
}

/// Loopback or private addresses: where a reverse proxy in front of us lives.
fn is_proxy(ip: IpAddr) -> bool {
    match ip.to_canonical() {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private(),
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unique_local(),
    }
}

/// `tower_governor` key extractor using [`client_ip`] with axum's `ConnectInfo`.
#[derive(Clone, Copy, Debug)]
pub struct ClientIpKeyExtractor;

impl KeyExtractor for ClientIpKeyExtractor {
    type Key = IpAddr;

    fn extract<T>(&self, req: &Request<T>) -> Result<Self::Key, GovernorError> {
        let peer = req
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(addr)| *addr);
        Ok(client_ip(req.headers(), peer))
    }
}

/// Replenish interval for `requests_per_second` sustained requests per key.
/// `GovernorConfigBuilder::per_second(n)` means one request every `n` seconds,
/// the inverse of what `API_RATE_LIMIT` promises, so the period is set directly.
pub fn governor_period(requests_per_second: u64) -> Duration {
    Duration::from_nanos(1_000_000_000 / requests_per_second.max(1))
}
```

In `src/api/routes.rs`, replace the cfg import block (lines 9-14) with:

```rust
#[cfg(not(test))]
use {
    crate::api::rate_limit::{governor_period, ClientIpKeyExtractor},
    std::sync::Arc,
    tower_governor::{governor::GovernorConfigBuilder, GovernorLayer},
};
```

Replace the whole rate-limiting comment and `#[cfg(not(test))] { ... }` block (lines 38-79) with:

```rust
    // Rate limit per client (see `api::rate_limit::client_ip` for how the client
    // is identified behind a proxy): API_RATE_LIMIT requests per second
    // sustained, bursts of twice that. Disabled in tests.
    #[cfg(not(test))]
    {
        let governor_conf = Arc::new(
            GovernorConfigBuilder::default()
                .key_extractor(ClientIpKeyExtractor)
                .period(governor_period(settings.server.api_rate_limit))
                .burst_size(
                    u32::try_from(settings.server.api_rate_limit.saturating_mul(2))
                        .unwrap_or(u32::MAX)
                        .max(1),
                )
                .finish()
                .unwrap(),
        );
        let governor_layer = GovernorLayer {
            config: governor_conf,
        };
        api_routes = api_routes.layer(governor_layer);
    }
```

In `src/main.rs`, replace

```rust
    axum::serve(listener, app)
```

with

```rust
    // Connect info gives the rate limiter each client's address.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib api::rate_limit && cargo build && cargo build --release`
Expected: `ok. 7 passed`. The debug build compiles the `#[cfg(not(test))]` governor block, which `cargo test` does not.

Manual check (governor only exists in non-test builds):

```bash
PORT=3999 INDEX_PATH=$(mktemp -d) DATABASE_URL="sqlite:$(mktemp -d)/f.db?mode=rwc" API_RATE_LIMIT=2 cargo run -- serve &
sleep 8
for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code} " "http://127.0.0.1:3999/api/stats"; done; echo
for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code} " -H "X-Forwarded-For: 198.51.100.$i" "http://127.0.0.1:3999/api/stats"; done; echo
kill %1
```

Expected: the first line starts with four `200`s (burst 2×2) and then shows `429`s. The second line is all `200`: each forwarded client has its own bucket, because the peer 127.0.0.1 is treated as a proxy.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/api/rate_limit.rs src/api/mod.rs src/api/routes.rs src/main.rs
git commit -m "Rate-limit the API per client at the configured requests per second"
```

---

### Task 17: Website search form filters

**Files:**
- Modify: `src/web/handlers.rs:1-8` (imports), `:24-36` (`SearchTemplate`), `:62-70` (`SearchParams`), `index` (from `let query = ...` to the end of the function)
- Modify: `src/web/templates/search.html` (whole file)
- Test: `src/api/routes.rs` `mod tests`

- [ ] **Step 1: Write the failing test**

Append inside `mod tests` in `src/api/routes.rs`:

```rust
    async fn get_html(state: &AppState, uri: &str) -> (StatusCode, String) {
        let app = create_router(state.clone(), &state.settings);
        let response = app
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn website_search_applies_filters_and_echoes_them_in_the_form() {
        let (state, _index_dir) = create_test_state().await;
        seed_search_fixture(&state).await;

        let (status, html) = get_html(&state, "/?tags=dinner&max_time=30").await;
        assert_eq!(status, StatusCode::OK);
        assert!(html.contains("Quick Garlic Pasta"));
        assert!(!html.contains("Slow Garlic Stew"));
        assert!(html.contains(r#"name="tags" value="dinner""#));
        assert!(html.contains(r#"<option value="30" selected>"#));
        assert!(html.contains("Clear filters"));
    }

    #[tokio::test]
    async fn website_language_dropdown_lists_languages() {
        let (state, _index_dir) = create_test_state().await;
        seed_search_fixture(&state).await;

        let (status, html) = get_html(&state, "/").await;
        assert_eq!(status, StatusCode::OK);
        assert!(html.contains("English (2)"));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib website_`
Expected: `website_search_applies_filters_and_echoes_them_in_the_form` FAILS. With only filter params the page renders the landing view: no results, no `name="tags"` input. `website_language_dropdown_lists_languages` passes; it guards the Task 14 refactor.

- [ ] **Step 3: Implement**

In `src/web/handlers.rs`, replace line 8 with:

```rust
use crate::{
    api::filters::FilterParams, api::handlers::AppState, db, error::Error,
    indexer::filters::SortOrder, indexer::search::SearchQuery, Result,
};
```

Replace `SearchTemplate` (lines 24-36) with:

```rust
/// Search page template
#[derive(Template)]
#[template(path = "search.html")]
struct SearchTemplate {
    query: String,
    locale: String,
    locales: Vec<LocaleOption>,
    results: Vec<RecipeCardData>,
    total: usize,
    page: usize,
    total_pages: usize,
    recent_recipes: Vec<RecipeCardData>,
    /// True when the page shows search results rather than the landing view.
    searching: bool,
    form: FilterForm,
    filters_active: bool,
    /// URL-encoded `key=value&...` of the current search, without `page`.
    pagination_query: String,
    /// Link to the same search with every structured filter removed.
    clear_filters_href: String,
}

/// Current structured-filter values, echoed back into the search form.
#[derive(Clone)]
#[allow(dead_code)] // Fields are used by Askama templates
struct FilterForm {
    tags: String,
    include_ingredients: String,
    exclude_ingredients: String,
    max_time: String,
    min_servings: String,
    max_servings: String,
    difficulty: String,
    feed_id: String,
    sort: String,
}

impl FilterForm {
    fn from_params(params: &FilterParams) -> Self {
        let value = |field: &Option<String>| field.as_deref().unwrap_or_default().trim().to_string();
        Self {
            tags: value(&params.tags),
            include_ingredients: value(&params.include_ingredients),
            exclude_ingredients: value(&params.exclude_ingredients),
            max_time: value(&params.max_time),
            min_servings: value(&params.min_servings),
            max_servings: value(&params.max_servings),
            difficulty: value(&params.difficulty),
            feed_id: value(&params.feed_id),
            sort: value(&params.sort),
        }
    }
}

/// `key=value&...` with URL-encoded values.
fn encode_query(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{key}={}", urlencoding::encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}
```

Replace the web `SearchParams` (lines 62-70) with:

```rust
#[derive(Deserialize)]
pub struct SearchParams {
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    q: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    locale: Option<String>,
    #[serde(default = "default_page")]
    page: usize,
    /// The same structured filters as `GET /api/search`.
    #[serde(flatten)]
    filters: FilterParams,
}
```

Replace the body of `index`, from `let query = params.q.clone().unwrap_or_default();` to the end of the function, with:

```rust
    let query = params.q.clone().unwrap_or_default();
    let locale = params.locale.clone().unwrap_or_default();
    let (filters, sort) = params.filters.parse()?;
    let filters_active = !filters.is_empty() || sort != SortOrder::Relevance;
    let searching = !query.is_empty() || !locale.is_empty() || filters_active;

    // Language filter options: one entry per language, most common first.
    let locales = crate::api::facets::language_facets(&state.pool)
        .await?
        .into_iter()
        .map(|facet| LocaleOption {
            code: facet.code,
            name: facet.name,
            count: facet.count,
        })
        .collect::<Vec<_>>();

    let (results, total, total_pages) = if !searching {
        (vec![], 0, 0)
    } else {
        let search_query = SearchQuery {
            q: query.clone(),
            page: params.page,
            limit: state.settings.pagination.web_default_limit,
            locale: params.locale.clone(),
        };

        let search_results = state.search_index.search_with(
            &search_query,
            &filters,
            sort,
            state.settings.pagination.max_search_results,
        )?;
        let total = search_results.total;
        let total_pages = search_results.total_pages;

        // Batch fetch tags for all recipes (avoid N+1 query problem)
        let recipe_ids: Vec<i64> = search_results.results.iter().map(|r| r.recipe_id).collect();
        let tags_map = db::tags::get_tags_for_recipes(&state.pool, &recipe_ids).await?;

        let mut results = vec![];

        // Fetch details for each result
        for result in search_results.results {
            let recipe = db::recipes::get_recipe(&state.pool, result.recipe_id)
                .await
                .ok();
            let tags = tags_map.get(&result.recipe_id).cloned().unwrap_or_default();

            if let Some(r) = recipe {
                results.push(RecipeCardData {
                    id: r.id,
                    title: r.title,
                    summary: r.summary.unwrap_or_default(),
                    tags,
                    servings: r.servings.map(|s| s.to_string()).unwrap_or_default(),
                    total_time_minutes: r
                        .total_time_minutes
                        .map(|t| t.to_string())
                        .unwrap_or_default(),
                    difficulty: r.difficulty.unwrap_or_default(),
                    image_url: r.image_url.unwrap_or_default(),
                    source_url: r.source_url.unwrap_or_default(),
                    locale_name: r
                        .locale
                        .as_deref()
                        .and_then(crate::indexer::locale::display_name)
                        .unwrap_or_default(),
                });
            }
        }

        (results, total, total_pages)
    };

    // Fetch recently indexed recipes for the homepage
    let recent_recipes = if !searching {
        let recipes = db::recipes::list_recently_indexed(&state.pool, 6).await?;
        let recipe_ids: Vec<i64> = recipes.iter().map(|r| r.id).collect();
        let tags_map = db::tags::get_tags_for_recipes(&state.pool, &recipe_ids).await?;

        recipes
            .into_iter()
            .map(|r| {
                let tags = tags_map.get(&r.id).cloned().unwrap_or_default();
                RecipeCardData {
                    id: r.id,
                    title: r.title,
                    summary: r.summary.unwrap_or_default(),
                    tags,
                    servings: r.servings.map(|s| s.to_string()).unwrap_or_default(),
                    total_time_minutes: r
                        .total_time_minutes
                        .map(|t| t.to_string())
                        .unwrap_or_default(),
                    difficulty: r.difficulty.unwrap_or_default(),
                    image_url: r.image_url.unwrap_or_default(),
                    source_url: r.source_url.unwrap_or_default(),
                    locale_name: r
                        .locale
                        .as_deref()
                        .and_then(crate::indexer::locale::display_name)
                        .unwrap_or_default(),
                }
            })
            .collect()
    } else {
        vec![]
    };

    // Links: pagination keeps every parameter; "Clear filters" keeps q and locale.
    let mut base_pairs: Vec<(&str, &str)> = Vec::new();
    if !query.is_empty() {
        base_pairs.push(("q", query.as_str()));
    }
    if !locale.is_empty() {
        base_pairs.push(("locale", locale.as_str()));
    }
    let clear_filters_href = format!("/?{}", encode_query(&base_pairs));
    let mut all_pairs = base_pairs.clone();
    all_pairs.extend(params.filters.query_pairs());
    let pagination_query = encode_query(&all_pairs);

    let template = SearchTemplate {
        query,
        locale,
        locales,
        results,
        total,
        page: params.page,
        total_pages,
        recent_recipes,
        searching,
        form: FilterForm::from_params(&params.filters),
        filters_active,
        pagination_query,
        clear_filters_href,
    };

    Ok(Html(template.render().map_err(|e| {
        Error::Internal(format!("Template render failed: {e}"))
    })?))
}
```

Replace `src/web/templates/search.html` entirely with:

```html
{% extends "base.html" %}

{% block title %}Search Recipes - Cooklang Federation{% endblock %}

{% block meta %}
<meta name="description" content="Search thousands of community Cooklang recipes — plain-text .cook files people actually cook from, hosted in their own repositories and indexed here.">
{% endblock %}

{% macro search_tips() %}
Search by field using <code class="bg-gray-100 px-1 rounded">tags:</code>, <code class="bg-gray-100 px-1 rounded">title:</code>, <code class="bg-gray-100 px-1 rounded">ingredients:</code>, or <code class="bg-gray-100 px-1 rounded">total_time:</code>. Every term must match; use <code class="bg-gray-100 px-1 rounded">OR</code> for alternatives, exclude with <code class="bg-gray-100 px-1 rounded">-</code>, use ranges like <code class="bg-gray-100 px-1 rounded">[0 TO 30]</code>, and quotes for multi-word values.
{% endmacro %}

{% block content %}
<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
    <!-- Search Header -->
    <div class="text-center mb-6 sm:mb-8">
        <h1 class="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">Discover Recipes</h1>
        <p class="text-gray-600">Search across federated recipe collections</p>
    </div>

    <!-- Search Form -->
    <div id="search-container" class="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6 sm:mb-8">
        <form method="GET" action="/">
            <div class="flex flex-col sm:flex-row gap-2">
                <input
                    id="search-input"
                    type="search"
                    name="q"
                    value="{{ query }}"
                    placeholder="Search query"
                    class="w-full min-w-0 sm:flex-1 px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                <!-- On phones the select and button share one row under the input;
                     from `sm` up this wrapper dissolves and they join the main row. -->
                <div class="flex gap-2 sm:contents">
                    {% if !locales.is_empty() %}
                    <select
                        id="locale-select"
                        name="locale"
                        class="flex-1 min-w-0 sm:flex-none px-3 sm:px-4 py-3 rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                        aria-label="Filter by language"
                    >
                        <option value="">All languages</option>
                        {% for option in locales %}
                        <option value="{{ option.code }}"{% if option.code == locale %} selected{% endif %}>{{ option.name }} ({{ option.count }})</option>
                        {% endfor %}
                    </select>
                    {% endif %}
                    <button
                        type="submit"
                        class="flex-1 sm:flex-none shrink-0 px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
                    >
                        Search
                    </button>
                </div>
            </div>

            <!-- Structured filters: the same parameters as GET /api/search -->
            <details id="search-filters" class="mt-3"{% if filters_active %} open{% endif %}>
                <summary class="cursor-pointer select-none text-sm font-medium text-orange-700">Filters</summary>
                <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                    <label class="flex flex-col gap-1">
                        <span class="text-gray-700">Tags (all of)</span>
                        <input type="text" name="tags" value="{{ form.tags }}" placeholder="vegan, dessert"
                            class="px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-gray-700">Uses ingredients</span>
                        <input type="text" name="include_ingredients" value="{{ form.include_ingredients }}" placeholder="garlic, lemon"
                            class="px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-gray-700">Without ingredients</span>
                        <input type="text" name="exclude_ingredients" value="{{ form.exclude_ingredients }}" placeholder="peanut"
                            class="px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-gray-700">Total time</span>
                        <select name="max_time" class="px-3 py-2 rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                            <option value="">Any time</option>
                            <option value="15"{% if form.max_time == "15" %} selected{% endif %}>15 minutes or less</option>
                            <option value="30"{% if form.max_time == "30" %} selected{% endif %}>30 minutes or less</option>
                            <option value="60"{% if form.max_time == "60" %} selected{% endif %}>1 hour or less</option>
                        </select>
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-gray-700">Difficulty</span>
                        <select name="difficulty" class="px-3 py-2 rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                            <option value="">Any</option>
                            <option value="easy"{% if form.difficulty == "easy" %} selected{% endif %}>Easy</option>
                            <option value="medium"{% if form.difficulty == "medium" %} selected{% endif %}>Medium</option>
                            <option value="hard"{% if form.difficulty == "hard" %} selected{% endif %}>Hard</option>
                        </select>
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-gray-700">Servings from</span>
                        <input type="number" min="0" name="min_servings" value="{{ form.min_servings }}"
                            class="px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-gray-700">Servings up to</span>
                        <input type="number" min="0" name="max_servings" value="{{ form.max_servings }}"
                            class="px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                    </label>
                    <label class="flex flex-col gap-1">
                        <span class="text-gray-700">Sort</span>
                        <select name="sort" class="px-3 py-2 rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent">
                            <option value="relevance"{% if form.sort != "newest" %} selected{% endif %}>Best match</option>
                            <option value="newest"{% if form.sort == "newest" %} selected{% endif %}>Newest first</option>
                        </select>
                    </label>
                </div>
                {% if !form.feed_id.is_empty() %}
                <input type="hidden" name="feed_id" value="{{ form.feed_id }}">
                {% endif %}
                {% if filters_active %}
                <p class="mt-3 text-sm"><a href="{{ clear_filters_href }}" class="text-orange-600 hover:text-orange-700 font-medium">Clear filters</a></p>
                {% endif %}
            </details>

            <details class="sm:hidden mt-3 text-xs text-gray-500">
                <summary class="cursor-pointer select-none text-orange-700 font-medium">Search tips</summary>
                <p class="mt-2 leading-relaxed">{% call search_tips() %}</p>
            </details>
            <p class="hidden sm:block mt-2 px-4 text-xs text-gray-500">
                {% call search_tips() %}
            </p>
        </form>
    </div>

    <!-- Results -->
    {% if !results.is_empty() %}
    <div class="mb-6">
        <p class="text-gray-600">Found {{ total }} recipes (page {{ page }} of {{ total_pages }})</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-8">
        {% for recipe in results %}
        {% include "_recipe_card.html" %}
        {% endfor %}
    </div>

    <!-- Pagination -->
    {% if total_pages > 1 %}
    <div class="flex flex-wrap justify-center gap-2">
        {% if page > 1 %}
        <a href="?{{ pagination_query }}&page={{ page - 1 }}" class="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Previous
        </a>
        {% endif %}

        <span class="px-4 py-2 bg-orange-600 text-white rounded-lg">
            Page {{ page }} of {{ total_pages }}
        </span>

        {% if page < total_pages %}
        <a href="?{{ pagination_query }}&page={{ page + 1 }}" class="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            Next
        </a>
        {% endif %}
    </div>
    {% endif %}

    {% else %}
    <div class="text-center py-8 sm:py-12">
        <div class="text-6xl mb-4">🔍</div>
        {% if !searching %}
        <p class="text-gray-600 text-lg">Enter a search query above to find recipes</p>
        {% else %}
        <p class="text-gray-600 text-lg">No recipes found. Try a different search!</p>
        {% endif %}
    </div>
    {% endif %}

    <!-- Recently Indexed Section -->
    {% if !recent_recipes.is_empty() %}
    <div class="mt-8 sm:mt-12">
        <div class="flex flex-wrap justify-between items-baseline gap-2 mb-6">
            <h2 class="text-2xl font-bold text-gray-900">Recently Indexed</h2>
            <a href="/browse" class="text-orange-600 hover:text-orange-700 font-medium">View all recipes →</a>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {% for recipe in recent_recipes %}
            {% include "_recipe_card.html" %}
            {% endfor %}
        </div>
    </div>
    {% endif %}
</div>

<script>
    // Scroll to search container when results are displayed
    {% if searching %}
    window.addEventListener('DOMContentLoaded', function() {
        const searchContainer = document.getElementById('search-container');
        if (searchContainer) {
            searchContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
    {% endif %}
</script>
{% endblock %}
```

The pagination links now URL-encode `q`. Before, they interpolated it raw, which HTML-escaped it but did not URL-encode it.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --lib website_ && cargo test --lib api::routes`
Expected: all ok.

Visual check. `output.css` is gitignored and built from the templates, so rebuild it to pick up the new classes:

```bash
./tailwindcss -i ./styles/input.css -o ./src/web/static/css/output.css
PORT=3999 cargo run -- serve
```

Open `http://127.0.0.1:3999/?tags=dessert&max_time=30`. Expected: the Filters panel is open with both values filled in, results are filtered, "Clear filters" returns to `/?`, and at 375 px width the grid is one column with no horizontal scroll.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/web/handlers.rs src/web/templates/search.html src/api/routes.rs
git commit -m "Add structured filters to the website search form"
```

---

### Task 18: Docs: About-page API reference, README, reindex release notes

**Files:**
- Modify: `src/web/templates/about.html:671-839` (the `<!-- API Documentation -->` block, up to but not including `<!-- CLI Usage -->`)
- Modify: `README.md` (`## API Endpoints` section; new first entry under `## Upgrading`)
- Modify: `src/main.rs:220-226` (startup banner)
- Test: `src/api/routes.rs` `mod tests`

- [ ] **Step 1: Write the failing test**

Append inside `mod tests` in `src/api/routes.rs`:

```rust
    #[tokio::test]
    async fn about_page_documents_the_real_api() {
        let (state, _index_dir) = create_test_state().await;
        let (status, html) = get_html(&state, "/about").await;
        assert_eq!(status, StatusCode::OK);

        for documented in [
            "/api/facets",
            "include_ingredients",
            "exclude_ingredients",
            "min_servings",
            "feed_id",
            "sort",
            "tag_limit",
            "total_time_minutes",
            // Literal template text is not HTML-escaped by Askama.
            r#""pagination": {"#,
        ] {
            assert!(html.contains(documented), "About page should document {documented}");
        }
        // Fields from the old, invented response examples that the API never had.
        for invented in ["recipe_url", "feed_name", "\"parsed\""] {
            assert!(!html.contains(invented), "{invented} is not a real API field");
        }
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --lib about_page_documents_the_real_api`
Expected: FAIL with `About page should document /api/facets`.

- [ ] **Step 3: Implement**

In `src/web/templates/about.html`, replace everything from the line `    <!-- API Documentation -->` up to (not including) the line `    <!-- CLI Usage -->` with:

```html
    <!-- API Documentation -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 class="text-2xl font-bold text-gray-900 mb-4">API Documentation</h2>
        <p class="text-gray-700 mb-4">
            A read-only JSON API over the same index this site searches. No authentication is needed and CORS allows every origin.
            Errors return a 4xx or 5xx status with a body of the form <code class="bg-gray-100 px-1 rounded">{"error": "message"}</code>.
        </p>

        <div class="space-y-6">
            <!-- Search Endpoint -->
            <div class="border-l-4 border-blue-500 pl-4">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-lg font-semibold text-gray-900">Search Recipes</h3>
                    <span class="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded">GET</span>
                </div>
                <p class="text-sm text-gray-600 mb-3">
                    <code class="bg-gray-900 text-gray-100 px-2 py-1 rounded">/api/search</code>
                </p>
                <p class="text-gray-700 mb-3 text-sm">
                    Every term in <code class="bg-gray-100 px-1 rounded">q</code> must match, and each structured filter narrows the results further.
                    Tag and ingredient filters are case-insensitive and stemmed, so <code class="bg-gray-100 px-1 rounded">tags=Desserts</code> matches "dessert".
                    List values are comma-separated and empty items are ignored.
                </p>

                <div class="bg-gray-50 rounded p-3 mb-3 overflow-x-auto">
                    <p class="text-sm font-semibold text-gray-900 mb-2">Query Parameters:</p>
                    <table class="w-full text-sm">
                        <tbody>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">q</td>
                                <td class="py-1 text-gray-700">Query string. Fields: <code>title:</code>, <code>tags:</code>, <code>ingredients:</code>, <code>instructions:</code>, <code>difficulty:</code>, <code>total_time:[0 TO 30]</code>; <code>OR</code>, <code>-exclude</code>, <code>"quoted phrases"</code>.</td>
                            </tr>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">locale</td>
                                <td class="py-1 text-gray-700">Language code, e.g. <code>de</code>. A base language also matches its regional variants (<code>en</code> matches <code>en-US</code>).</td>
                            </tr>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">tags</td>
                                <td class="py-1 text-gray-700">Recipe has <strong>all</strong> of these tags, e.g. <code>vegan,dessert</code>.</td>
                            </tr>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">include_ingredients</td>
                                <td class="py-1 text-gray-700">Recipe uses <strong>all</strong> of these ingredients, e.g. <code>garlic,lemon</code>.</td>
                            </tr>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">exclude_ingredients</td>
                                <td class="py-1 text-gray-700">Recipe uses <strong>none</strong> of these, e.g. <code>peanut</code>.</td>
                            </tr>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">max_time</td>
                                <td class="py-1 text-gray-700">Total time at most this many minutes. Recipes without a total time are excluded.</td>
                            </tr>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">min_servings, max_servings</td>
                                <td class="py-1 text-gray-700">Inclusive servings range.</td>
                            </tr>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">difficulty</td>
                                <td class="py-1 text-gray-700">Exact difficulty, case-insensitive, e.g. <code>easy</code>.</td>
                            </tr>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">feed_id</td>
                                <td class="py-1 text-gray-700">Only recipes from this feed (ids from <code>/api/feeds</code>).</td>
                            </tr>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">sort</td>
                                <td class="py-1 text-gray-700"><code>relevance</code> (default) or <code>newest</code>.</td>
                            </tr>
                            <tr class="border-b border-gray-200">
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">page</td>
                                <td class="py-1 text-gray-700">Page number, from 1 (default 1).</td>
                            </tr>
                            <tr>
                                <td class="py-1 pr-4 font-mono text-xs text-orange-600">limit</td>
                                <td class="py-1 text-gray-700">Results per page (default 20, max 100).</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="text-gray-700 mb-3 text-sm">A malformed <code class="bg-gray-100 px-1 rounded">q</code>, a non-numeric number, or an unknown <code class="bg-gray-100 px-1 rounded">sort</code> returns 400 with a message.</p>

                <p class="text-sm font-semibold text-gray-900 mb-1">Example Request:</p>
                <pre class="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto mb-3"><code>GET /api/search?q=cookies&amp;tags=dessert&amp;max_time=60&amp;limit=10</code></pre>

                <p class="text-sm font-semibold text-gray-900 mb-1">Example Response:</p>
                <pre class="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto mb-3"><code>{
  "results": [
    {
      "id": 123,
      "title": "Chocolate Chip Cookies",
      "summary": "Crispy outside, chewy inside.",
      "tags": ["baking", "cookies", "dessert"],
      "locale": "en",
      "total_time_minutes": 45,
      "servings": 24,
      "difficulty": "easy",
      "image_url": "https://example.com/cookies.jpg",
      "feed": { "id": 12, "title": "Jane's Recipes" }
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 1, "total_pages": 1 }
}</code></pre>
                <p class="text-gray-700 text-sm">Every card field other than <code class="bg-gray-100 px-1 rounded">id</code>, <code class="bg-gray-100 px-1 rounded">title</code> and <code class="bg-gray-100 px-1 rounded">tags</code> may be <code class="bg-gray-100 px-1 rounded">null</code>.</p>
            </div>

            <!-- Facets Endpoint -->
            <div class="border-l-4 border-blue-500 pl-4">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-lg font-semibold text-gray-900">Filter Values</h3>
                    <span class="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded">GET</span>
                </div>
                <p class="text-sm text-gray-600 mb-3">
                    <code class="bg-gray-900 text-gray-100 px-2 py-1 rounded">/api/facets</code>
                </p>
                <p class="text-gray-700 mb-3 text-sm">
                    Tags, languages and difficulties with recipe counts, most common first. Use it to build filter UIs. Refreshed every five minutes.
                    Optional <code class="bg-gray-100 px-1 rounded">tag_limit</code>: number of tags (default 200, max 1000).
                </p>
                <pre class="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto"><code>{
  "tags": [{ "name": "dessert", "count": 123 }],
  "locales": [{ "code": "en", "name": "English", "count": 900 }],
  "difficulties": [{ "name": "easy", "count": 40 }]
}</code></pre>
            </div>

            <!-- Recipe Details Endpoint -->
            <div class="border-l-4 border-blue-500 pl-4">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-lg font-semibold text-gray-900">Get Recipe Details</h3>
                    <span class="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded">GET</span>
                </div>
                <p class="text-sm text-gray-600 mb-3">
                    <code class="bg-gray-900 text-gray-100 px-2 py-1 rounded">/api/recipes/:id</code>
                </p>
                <p class="text-gray-700 mb-3 text-sm">The full record, including the raw Cooklang source. <code class="bg-gray-100 px-1 rounded">locale_source</code> is <code class="bg-gray-100 px-1 rounded">declared</code> (from a <code class="bg-gray-100 px-1 rounded">locale:</code> key) or <code class="bg-gray-100 px-1 rounded">detected</code>.</p>
                <pre class="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto"><code>{
  "id": 123,
  "title": "Chocolate Chip Cookies",
  "summary": "Crispy outside, chewy inside.",
  "content": "---\ntitle: Chocolate Chip Cookies\n---\nCream @butter{200%g} ...",
  "ingredients": [{ "name": "butter", "quantity": 200.0, "unit": "g" }],
  "tags": ["cookies", "dessert"],
  "servings": 24,
  "total_time_minutes": 45,
  "active_time_minutes": 20,
  "difficulty": "easy",
  "image_url": "https://example.com/cookies.jpg",
  "source_url": "https://example.com/recipes/cookies",
  "enclosure_url": "https://example.com/recipes/cookies.cook",
  "locale": "en",
  "locale_source": "declared",
  "feed": { "id": 12, "title": "Jane's Recipes", "author": "Jane Doe" }
}</code></pre>
            </div>

            <!-- Download Recipe Endpoint -->
            <div class="border-l-4 border-blue-500 pl-4">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-lg font-semibold text-gray-900">Download Recipe File</h3>
                    <span class="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded">GET</span>
                </div>
                <p class="text-sm text-gray-600 mb-3">
                    <code class="bg-gray-900 text-gray-100 px-2 py-1 rounded">/api/recipes/:id/download</code>
                </p>
                <p class="text-gray-700 text-sm">The raw <code class="bg-gray-100 px-1 rounded">.cook</code> file as <code class="bg-gray-100 px-1 rounded">text/plain</code>. 404 when the content could not be fetched.</p>
            </div>

            <!-- Feeds Endpoints -->
            <div class="border-l-4 border-blue-500 pl-4">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-lg font-semibold text-gray-900">Feeds</h3>
                    <span class="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded">GET</span>
                </div>
                <p class="text-sm text-gray-600 mb-3">
                    <code class="bg-gray-900 text-gray-100 px-2 py-1 rounded">/api/feeds</code>
                    <code class="bg-gray-900 text-gray-100 px-2 py-1 rounded">/api/feeds/:id</code>
                </p>
                <p class="text-gray-700 mb-3 text-sm">Registered feeds, paginated with <code class="bg-gray-100 px-1 rounded">page</code> and <code class="bg-gray-100 px-1 rounded">limit</code>, optionally filtered by <code class="bg-gray-100 px-1 rounded">status</code>. <code class="bg-gray-100 px-1 rounded">/api/feeds/:id</code> returns one feed in the same shape.</p>
                <pre class="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto"><code>{
  "feeds": [
    {
      "id": 12,
      "url": "https://example.com/feed.xml",
      "title": "Jane's Recipes",
      "author": "Jane Doe",
      "status": "active",
      "recipe_count": 42,
      "last_fetched_at": "2026-09-25T10:00:00+00:00",
      "created_at": "2026-01-01T00:00:00+00:00"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "total_pages": 1 }
}</code></pre>
            </div>

            <!-- Stats Endpoint -->
            <div class="border-l-4 border-blue-500 pl-4">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-lg font-semibold text-gray-900">System Statistics</h3>
                    <span class="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded">GET</span>
                </div>
                <p class="text-sm text-gray-600 mb-3">
                    <code class="bg-gray-900 text-gray-100 px-2 py-1 rounded">/api/stats</code>
                </p>
                <p class="text-gray-700 mb-3 text-sm">Totals: <code class="bg-gray-100 px-1 rounded">total_recipes</code>, <code class="bg-gray-100 px-1 rounded">total_feeds</code>, <code class="bg-gray-100 px-1 rounded">total_tags</code>, <code class="bg-gray-100 px-1 rounded">total_ingredients</code>, <code class="bg-gray-100 px-1 rounded">active_feeds</code>.</p>
                <p class="text-sm">
                    <a href="/api/stats" class="text-orange-600 hover:text-orange-700 underline font-medium">View live stats →</a>
                </p>
            </div>
        </div>

        <div class="mt-6 bg-yellow-50 border-l-4 border-yellow-400 p-4">
            <div class="flex items-start">
                <svg class="h-4 w-4 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                    <p class="text-sm text-yellow-800 font-semibold mb-1">Rate Limiting</p>
                    <p class="text-sm text-yellow-700">
                        Every <code>/api</code> endpoint is limited per client IP address, to 100 requests per second on this instance with bursts of twice that.
                        Over the limit you get HTTP 429 (Too Many Requests). Back off and retry.
                        For higher limits, run your own federation instance.
                    </p>
                </div>
            </div>
        </div>
    </div>

```

In `README.md`, replace the `## API Endpoints` section (from `## API Endpoints` up to, not including, `## Configuration`) with:

````markdown
## API Endpoints

The API is read-only JSON. Errors are `{"error": "message"}` with a 4xx/5xx
status. `/api/*` is rate-limited per client IP (see `API_RATE_LIMIT`).

### Health & Status
- `GET /health` - Health check
- `GET /ready` - Readiness check
- `GET /api/stats` - Totals: `total_recipes`, `total_feeds`, `total_tags`, `total_ingredients`, `active_feeds`

### Search
- `GET /api/search` - Search recipes. Every term in `q` must match
  (`vegan tags:dessert` is vegan **and** dessert); use `OR` for alternatives and
  `-` to exclude. Words are stemmed, so `cake` finds "cakes".

  | Param | Example | Meaning |
  |---|---|---|
  | `q` | `q=pasta tags:italian` | Query string (field syntax as above) |
  | `locale` | `locale=de` | Language; `en` also matches `en-US` |
  | `tags` | `tags=vegan,dessert` | Has **all** tags (stemmed, case-insensitive) |
  | `include_ingredients` | `include_ingredients=garlic,lemon` | Uses **all** ingredients |
  | `exclude_ingredients` | `exclude_ingredients=peanut` | Uses **none** of them |
  | `max_time` | `max_time=30` | Total time ≤ minutes |
  | `min_servings`, `max_servings` | `min_servings=2&max_servings=6` | Inclusive range |
  | `difficulty` | `difficulty=easy` | Exact, case-insensitive |
  | `feed_id` | `feed_id=12` | Only this feed |
  | `sort` | `sort=newest` | `relevance` (default) or `newest` |
  | `page`, `limit` | `page=2&limit=20` | Paging (limit max 100) |

  Invalid numbers, an unknown `sort` or a malformed `q` return `400`. Each
  result card has `id`, `title`, `summary`, `tags`, `locale`,
  `total_time_minutes`, `servings`, `difficulty`, `image_url` and
  `feed: {id, title}`. Any field except `id`, `title` and `tags` may be null.
- `GET /api/facets?tag_limit=200` - Tag, language and difficulty values with
  recipe counts, for filter UIs. Cached for 5 minutes; `tag_limit` defaults to
  200, max 1000.

### Recipes
- `GET /api/recipes/:id` - Recipe details, including `locale` (e.g. `"de"`,
  `"en-US"`) and `locale_source` (`"declared"` if set via a Cooklang `locale:`
  key, or `"detected"` if inferred from the recipe text)
- `GET /api/recipes/:id/download` - Download .cook file

### Feeds
- `GET /api/feeds` - List feeds (`page`, `limit`, `status`)
- `GET /api/feeds/:id` - Get feed details

Feeds are registered through `config/feeds.yaml`, not the API.

````

In `README.md`, add this as the first subsection under `## Upgrading` (above `### Search quality release (search index rebuild required)`):

````markdown
### Recipe Hub API release (search index rebuild required)

This release adds `feed_id`, `indexed_at`, `image_url` and `feed_title` to the
Tantivy schema and makes `servings` and `total_time` indexed, for the new
structured search filters, `sort=newest` and richer result cards. As with
earlier schema changes, **the server refuses to start** against an index built
by a previous version.

Rebuild before starting `serve`:

```bash
rm -rf data/index   # or your configured INDEX_PATH
federation backfill-locales --force
```

With Docker Compose, stop the app first, then run the rebuild in a one-off container:

```bash
docker compose stop app
rm -rf data/index
docker compose run --rm app federation backfill-locales --force
docker compose up -d app
```

`backfill-locales --force` is the full rebuild: it re-indexes every recipe with
its tags, ingredients and feed title. (`federation reindex <url>` is a
different command: it deletes one feed's recipes from the database and
re-crawls that feed, and it does not rebuild the search index.)

Other behaviour changes:

- **Feed recipes are indexed as they are crawled.** Before, recipes from
  RSS/Atom feeds (and their `<category>` tags) reached the search index only
  through `backfill-locales`.
- **Rate limiting is per client and matches `API_RATE_LIMIT`.** It used to be
  one bucket for everyone that refilled one request every `API_RATE_LIMIT`
  seconds. Now each client gets `API_RATE_LIMIT` requests per second with
  bursts of twice that. Behind a reverse proxy on loopback or a private
  network, the first `X-Forwarded-For` address identifies the client.
  `X-Forwarded-For` from any other peer is ignored, so make sure your proxy
  connects from such an address.
- **A malformed `q` returns `400`** with the parser's message instead of `500`.
- The website search form has the same filters as the API.

````

In `src/main.rs`, replace the banner endpoint lines (currently 220-226) with:

```rust
    println!("\nAPI Endpoints:");
    println!("  GET  /api/search");
    println!("  GET  /api/facets");
    println!("  GET  /api/recipes/:id");
    println!("  GET  /api/recipes/:id/download");
    println!("  GET  /api/feeds");
    println!("  GET  /api/feeds/:id");
    println!("  GET  /api/stats");
```

- [ ] **Step 4: Run to verify it passes, then the full CI gate**

Run: `cargo test --lib about_page_documents_the_real_api`
Expected: PASS.

Run the full gate CI uses:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
cargo build --release
```

Expected: every command exits 0; `cargo test` shows no `FAILED`.

Rebuild smoke test against a copy of real data (optional but recommended before deploying):

```bash
cp data/federation.db /tmp/fed-copy.db
DATABASE_URL=sqlite:/tmp/fed-copy.db INDEX_PATH=/tmp/fed-index cargo run --release -- backfill-locales --force
DATABASE_URL=sqlite:/tmp/fed-copy.db INDEX_PATH=/tmp/fed-index PORT=3999 cargo run --release -- serve &
sleep 5
curl -s "http://127.0.0.1:3999/api/search?tags=dessert&max_time=60&limit=3" | head -c 800; echo
curl -s "http://127.0.0.1:3999/api/facets?tag_limit=5"; echo
kill %1
```

Expected: search cards include `feed` and, where known, `image_url`/`total_time_minutes`; facets list real tags and languages.

- [ ] **Step 5: Commit**

```bash
cargo fmt --all
git add src/web/templates/about.html README.md src/main.rs src/api/routes.rs
git commit -m "Document the search filters, facets and index rebuild"
```

Do not push or open a PR from this plan. Hand off with superpowers:finishing-a-development-branch.

---

## Self-review against spec §1 and §4 (federation)

| Spec item | Where |
|---|---|
| §1.1 `tags` (all) | Task 5 (`filter_clauses`), Task 9 (parse), Task 10 (HTTP) |
| §1.1 `include_ingredients` (all) | Task 5, 9, 10 |
| §1.1 `exclude_ingredients` (`MustNot`) | Task 5, 9, 10 |
| §1.1 `max_time` ≤ | Task 6, 9, 10 |
| §1.1 `min_servings`/`max_servings` inclusive | Task 6, 9, 10 (min>max → 400 too) |
| §1.1 `difficulty` exact, lowercase | Task 3 (normalised at index time), Task 6, 9 |
| §1.1 `feed_id` | Task 2 (field), Task 6, 9 |
| §1.1 `sort` relevance/newest | Task 7, 9, 10 |
| §1.1 comma lists trimmed, empties ignored | Task 9 (`split_list`), Task 5 (blank value → no clause) |
| §1.1 same tokenizer/stemmer (`tags=Desserts` ≈ dessert) | Task 5 (`text_match_query` via `tokenizer_for_field`) |
| §1.1 invalid numbers → 400 "like invalid q" | Task 9/10; invalid `q` itself fixed to 400 in Task 8 (it was 500) |
| §1.1 schema: INDEXED time/servings, `feed_id`, `indexed_at`, `image_url`, `feed_title` | Task 2 |
| §1.1 full reindex documented in release notes | Task 18 (README Upgrading) |
| §1.2 card fields from stored index fields | Task 3 (store), Task 4 (read), Task 10 (`RecipeCard`, `CardFeed`) |
| §1.3 `/api/facets` tags top N (`tag_limit` 200/1000) | Task 14 (`top_tags`), Task 15 (`parse_tag_limit`, truncate) |
| §1.3 locales reuse website query | Task 14 (`language_facets`, web handler switched to it) |
| §1.3 difficulties | Task 14 (`list_difficulties`) |
| §1.3 5-minute cache, same `/api` rate limit | Task 15 (`FacetsCache`, route under `api_routes`) |
| §1.4 index tags at every call site; remove placeholders | Task 3 (placeholders removed), Task 11 (`reindex_recipes`), Task 12 (GitHub/backfill/cleanup), Task 13 (crawler) |
| §1.4 tags regression (`tags:` and `tags=`) | Task 11 `database_tags_are_found_by_tags_query_and_tags_filter` |
| §1.4 rate-limit key: connect info + first XFF hop behind proxy | Task 16 (plus the `per_second` quota fix) |
| §1.4 About page API docs rewrite | Task 18 |
| §1.4 website form filters, same params | Task 17 (shares `FilterParams`) |
| §1.5 additive/compatible | New params optional, blank values ignored; old card fields unchanged; `feed` etc. nullable |
| §4 each filter; combined with `q` and `locale` | Tasks 5-6 (`filters_combine_with_query_and_locale`, `numeric_filters_combine_with_the_query`), Task 10 HTTP |
| §4 `exclude_ingredients`, `sort=newest`, invalid numbers → 400 | Tasks 5, 7, 9, 10 |
| §4 facets counts and cache | Task 14, Task 15 |
| §4 card fields populated | Tasks 4, 10 |
| §4 tags regression; rate-limit key extraction | Tasks 11, 16 |

Placeholder scan: no TBD/TODO. Every code step has complete code, and every type or function used is defined in the task named:

- `IndexExtras`: Task 3, and its `load`: Task 11
- `SearchFilters`/`SortOrder`/`normalize_difficulty`: Tasks 3 and 5
- `search_with`: Task 5, with the 4-argument signature from Task 7
- `result_from_doc`/`stored_*`: Task 4
- `unscored`/`text_match_query`/`filter_clauses`: Tasks 5 and 6
- `LockedWriter`/`locked_writer`/`reindex_recipes`: Task 11
- `FilterParams`: Task 9
- `CardFeed`: Task 10
- facet models, `language_facets` and `load_facets`: Task 14
- `FacetsCache`/`parse_tag_limit`/`get_facets`: Task 15
- `client_ip`/`ClientIpKeyExtractor`/`governor_period`: Task 16
- `FilterForm`/`encode_query`: Task 17
- test helpers `seed_search_fixture`/`get_json`: Task 10, and `get_html`: Task 17

Type consistency:
- `search_with(query, filters, sort, max_limit)` is used with that argument order in Tasks 7, 8, 10, 11, 12, 13 and 17. The Task 5 helper `ids` is updated in Task 7.
- `index_recipe_full(writer, recipe, &IndexExtras)` is the same everywhere.

Gaps found during review and fixed inline:
- The spec's crawler call site did not exist, so Task 13 was added.
- `limit=0` panicked, fixed in Task 7.
- The governor quota was inverted, fixed in Task 16.
- Pagination links did not carry filters, fixed in Task 17.
