# cook.md `/help/plugins` Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document Cook Editor plugins on cook.md — using them, the default Shopping List plugin, building one, the Cooklang API, the outlets, and publishing — and fix the editor help's inaccurate shopping-list text.

**Architecture:** A new `Help::PluginsController` with six static ERB pages, mirroring `Help::TemplatesController` exactly (same layout switch, sidebar partial, breadcrumbs, bottom page nav). Request specs check routes, redirects and key content.

**Tech Stack:** Rails (cook.md `web/`), ERB, RSpec request specs, RuboCop.

**Spec:** `editor/docs/superpowers/specs/2026-09-24-shopping-list-plugin-design.md` (Part 5).

**Prerequisite:** the editor plan (Tasks 1–11) and the plugin plan are done, so every name below can be checked against real code. **Accuracy rule:** before committing each page, verify each command id, menu label, context field and file path against
`/Users/alexeydubovskoy/Cooklang/editor-worktrees/plugin-outlets/packages/cooklang/src/browser/{cooklang-outlets.ts,cooklang-plugin-api-contribution.ts}`,
`.../packages/cooklang/src/common/cooklang-outlet-context.ts` and
`/Users/alexeydubovskoy/Cooklang/plugins/shopping-list/package.json`. Fix the page, not the code, when they differ.

---

## Working environment

```bash
cd /Users/alexeydubovskoy/Cooklang/cook.md
git fetch origin
git switch -c feature/help-plugins origin/main
cd web
```

Leave the untracked files in `recipe-pack/` alone. Run specs with `bundle exec rspec spec/requests/help/plugins_spec.rb`, lint with `bundle exec rubocop app/controllers/help/plugins_controller.rb config/routes.rb spec/requests/help/plugins_spec.rb`. Reference pages to imitate: `app/views/help/templates/overview.html.erb` (page skeleton) and `app/views/help/templates/_page_navigation.html.erb`.

Every page uses this skeleton (only the title, `current_page`, on-this-page links, `<main>` sections and bottom nav change):

```erb
<% content_for :title, "PAGE TITLE" %>
<% content_for :head do %>
  <%= render "help/help/styles" %>
<% end %>

<%= render "help/help/site_header" %>

<div class="help-container">
  <aside class="help-sidebar">
    <%= render "help/plugins/page_navigation", current_page: :PAGE_KEY %>

    <nav>
      <h3>On This Page</h3>
      <ul>
        <!-- one <li><a href="#id">…</a></li> per section; the first gets class="active" -->
      </ul>
    </nav>
  </aside>

  <main class="help-content">
    <%= render "help/help/breadcrumbs", section_title: "Plugins", section_path: help_plugins_path %>

    <!-- sections -->

    <nav class="page-nav-bottom">
      <!-- prev / next links -->
    </nav>
  </main>
</div>
```

## File map

| File | Status |
|---|---|
| `web/app/controllers/help/plugins_controller.rb` | create |
| `web/config/routes.rb` | modify (inside `namespace :help`, after the templates block) |
| `web/app/views/help/plugins/_page_navigation.html.erb` | create |
| `web/app/views/help/plugins/{overview,shopping_list,getting_started,api,outlets,publishing}.html.erb` | create |
| `web/app/views/help/help/index.html.erb` | modify (new card after Report Templates) |
| `web/app/views/help/editor/features.html.erb`, `getting_started.html.erb` | modify (shopping sections) |
| `web/app/assets/images/help/plugins/outlets.png` | create (screenshot from the E2E run) |
| `web/spec/requests/help/plugins_spec.rb` | create |
| `web/spec/requests/help/editor_spec.rb` | modify (shopping text) |

---

### Task 1: Controller, routes, navigation, spec skeleton

**Files:** create `plugins_controller.rb`, `_page_navigation.html.erb`, `plugins_spec.rb`; modify `routes.rb`

- [ ] **Step 1: Write the failing spec**

`web/spec/requests/help/plugins_spec.rb`:

```ruby
# frozen_string_literal: true

require "rails_helper"

describe "Help::Plugins", type: :request do
  {
    "/help/plugins" => "Plugins",
    "/help/plugins/shopping-list" => "Shopping List",
    "/help/plugins/getting-started" => "Build your first plugin",
    "/help/plugins/api" => "Cooklang API",
    "/help/plugins/outlets" => "Outlets",
    "/help/plugins/publishing" => "Publishing"
  }.each do |path, heading|
    describe "GET #{path}" do
      it "returns http success with the page heading and the section navigation" do
        get path
        expect(response).to have_http_status(:success)
        expect(response.body).to include(heading)
        expect(response.body).to include(help_plugins_shopping_list_path)
        expect(response.body).to include(help_plugins_outlets_path)
      end
    end
  end

  describe "GET /help/plugins/overview" do
    it "301-redirects to the canonical section URL" do
      get "/help/plugins/overview"
      expect(response).to redirect_to("/help/plugins")
      expect(response).to have_http_status(:moved_permanently)
    end
  end

  describe "GET /help/plugins?content_only=true" do
    it "renders without the site chrome" do
      get "/help/plugins", params: { content_only: "true" }
      expect(response).to have_http_status(:success)
    end
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `bundle exec rspec spec/requests/help/plugins_spec.rb`
Expected: FAIL — routing errors / undefined `help_plugins_shopping_list_path`.

- [ ] **Step 3: Controller, routes, navigation**

`web/app/controllers/help/plugins_controller.rb`:

```ruby
# frozen_string_literal: true

module Help
  class PluginsController < ApplicationController
    layout :set_layout

    def overview
    end

    def shopping_list
    end

    def getting_started
    end

    def api
    end

    def outlets
    end

    def publishing
    end

    private
      def set_layout
        if params[:content_only] == "true"
          "content"
        else
          "application"
        end
      end
  end
end
```

In `web/config/routes.rb`, directly after the `templates/plans` route:

```ruby
    # Plugins help
    get "plugins", to: "plugins#overview", as: :plugins
    get "plugins/overview", to: redirect("/help/plugins", status: 301)
    get "plugins/shopping-list", to: "plugins#shopping_list", as: :plugins_shopping_list
    get "plugins/getting-started", to: "plugins#getting_started", as: :plugins_getting_started
    get "plugins/api", to: "plugins#api", as: :plugins_api
    get "plugins/outlets", to: "plugins#outlets", as: :plugins_outlets
    get "plugins/publishing", to: "plugins#publishing", as: :plugins_publishing
```

`web/app/views/help/plugins/_page_navigation.html.erb`:

```erb
<div class="help-sidebar-pages">
  <h3>Plugins</h3>
  <ul>
    <li>
      <%= link_to "Overview", help_plugins_path, class: current_page == :overview ? "active" : "" %>
    </li>
    <li>
      <%= link_to "Shopping List", help_plugins_shopping_list_path, class: current_page == :shopping_list ? "active" : "" %>
    </li>
    <li>
      <%= link_to "Build Your First Plugin", help_plugins_getting_started_path, class: current_page == :getting_started ? "active" : "" %>
    </li>
    <li>
      <%= link_to "Cooklang API", help_plugins_api_path, class: current_page == :api ? "active" : "" %>
    </li>
    <li>
      <%= link_to "Outlets", help_plugins_outlets_path, class: current_page == :outlets ? "active" : "" %>
    </li>
    <li>
      <%= link_to "Publishing", help_plugins_publishing_path, class: current_page == :publishing ? "active" : "" %>
    </li>
  </ul>
</div>
```

Create the six view files as one-line placeholders so routes render — each is replaced by its real content in Tasks 2–7 before this branch is merged:

```bash
for page in overview shopping_list getting_started api outlets publishing; do
  printf '<%%= render "help/plugins/page_navigation", current_page: :%s %%>\n' "$page" > app/views/help/plugins/$page.html.erb
done
```

- [ ] **Step 4: Run the spec**

Run: `bundle exec rspec spec/requests/help/plugins_spec.rb`
Expected: routing and redirect examples pass; the heading examples still fail (no headings yet) — they turn green as Tasks 2–7 land.

- [ ] **Step 5: Commit**

```bash
git add app/controllers/help/plugins_controller.rb config/routes.rb app/views/help/plugins spec/requests/help/plugins_spec.rb
git commit -m "feat(help): /help/plugins section skeleton"
```

---

### Task 2: Overview page

**Files:** replace `web/app/views/help/plugins/overview.html.erb`; add examples to `plugins_spec.rb`

- [ ] **Step 1: Spec**

Add inside the top-level `describe` in `plugins_spec.rb`:

```ruby
  describe "overview content" do
    it "explains installing and disabling plugins and names the default plugin" do
      get "/help/plugins"
      expect(response.body).to include("plugins.cook.md")
      expect(response.body).to include("Extensions")
      expect(response.body).to include("Shopping List")
    end
  end
```

- [ ] **Step 2: Page**

`overview.html.erb` — skeleton with title `"Plugins"`, `current_page: :overview`, on-this-page links `#introduction` (active), `#installing`, `#default-plugins`, `#building`, and this `<main>` body:

```erb
    <section id="introduction">
      <h1>Plugins</h1>
      <p class="text-lg" style="font-size: 1.125rem; color: #6b7280; margin-bottom: 2rem;">
        Plugins add features to <%= link_to "Cook Editor", editor_static_pages_path %> — new panels, buttons in the recipe preview, commands, even new file types. Cook Editor runs the same kind of extensions as VS Code, plus a small Cooklang API, so a plugin can work with your recipes the way the built-in features do.
      </p>
    </section>

    <section id="installing">
      <h2>Installing and turning plugins off</h2>
      <p>
        Open the <strong>Extensions</strong> view from the activity bar on the left. It searches <a href="https://plugins.cook.md">plugins.cook.md</a>, the Cook plugin marketplace. Click <strong>Install</strong> on a plugin and it's active straight away.
      </p>
      <p>
        To turn a plugin off, find it under <strong>Installed</strong> and choose <strong>Disable</strong>. Its buttons and panels disappear; your files are untouched. <strong>Uninstall</strong> removes it completely.
      </p>
    </section>

    <section id="default-plugins">
      <h2>Plugins that come with Cook Editor</h2>
      <ul>
        <li><strong><%= link_to "Shopping List", help_plugins_shopping_list_path %></strong> — builds an aisle-grouped shopping list from recipes and menus, subtracting what's in your pantry.</li>
      </ul>
      <p>
        Default plugins are ordinary plugins: you can disable them like any other, and they're built with exactly the same API third-party plugins use.
      </p>
    </section>

    <section id="building">
      <h2>Building your own</h2>
      <p>
        If you know a little TypeScript you can write a plugin in an afternoon. Start with <%= link_to "Build your first plugin", help_plugins_getting_started_path %>, then see the <%= link_to "Cooklang API", help_plugins_api_path %> and the <%= link_to "outlets", help_plugins_outlets_path %> where plugins can add buttons. When it's ready, <%= link_to "publish it", help_plugins_publishing_path %> to plugins.cook.md.
      </p>
    </section>
```

Bottom nav: empty `nav-prev`; `nav-next` → `link_to help_plugins_shopping_list_path do %>Next: Shopping List <span>&rarr;</span><% end %>`.

- [ ] **Step 3: Verify accuracy**

Launch the editor build from the editor plan and confirm the Extensions view name, the Install/Disable/Uninstall labels, and that its search hits plugins.cook.md (`VSX_REGISTRY_URL`, see `packages/cooklang-branding/src/electron-main/cooklang-branding-electron-main-module.ts`). Fix wording to match.

- [ ] **Step 4: Run spec and commit**

Run: `bundle exec rspec spec/requests/help/plugins_spec.rb -e "overview"` and `-e "GET /help/plugins returns"` → PASS.

```bash
git add app/views/help/plugins/overview.html.erb spec/requests/help/plugins_spec.rb
git commit -m "docs(help): plugins overview"
```

---

### Task 3: Shopping List page

**Files:** replace `shopping_list.html.erb`; add spec examples

- [ ] **Step 1: Spec**

```ruby
  describe "shopping list content" do
    it "covers adding, aisles, pantry and the list files" do
      get "/help/plugins/shopping-list"
      expect(response.body).to include("Add to Shopping List")
      expect(response.body).to include("config/aisle.conf")
      expect(response.body).to include("config/pantry.conf")
      expect(response.body).to include(".shopping-list")
      expect(response.body).to include(".shopping-checked")
    end
  end
```

- [ ] **Step 2: Page**

Skeleton with title `"Shopping List Plugin"`, `current_page: :shopping_list`, on-this-page: `#introduction`, `#adding`, `#working-with-the-list`, `#aisles-and-pantry`, `#files`, `#panel`. `<main>` body:

```erb
    <section id="introduction">
      <h1>Shopping List</h1>
      <p class="text-lg" style="font-size: 1.125rem; color: #6b7280; margin-bottom: 2rem;">
        The Shopping List plugin comes with Cook Editor. It combines the ingredients of the recipes and menus you add, merges duplicates, groups them by supermarket aisle and leaves out what's already in your pantry.
      </p>
    </section>

    <section id="adding">
      <h2>Adding recipes and menus</h2>
      <ul>
        <li><strong>From the preview:</strong> click the cart button in the header of a recipe or menu preview. The recipe is added at the scale the preview shows.</li>
        <li><strong>From the explorer:</strong> right-click a <code>.cook</code> file and choose <strong>Add to Shopping List</strong>, or a <code>.menu</code> file and choose <strong>Add Menu to Shopping List</strong>.</li>
        <li><strong>From the editor:</strong> the cart button in the editor title bar, or <strong>Shopping List: Add to Shopping List</strong> in the command palette.</li>
        <li><strong>From CookBot:</strong> ask it to "add carbonara to my shopping list".</li>
      </ul>
      <p>
        Recipes that reference other recipes (<code>@./Sauce{4%servings}</code>) bring those ingredients along, scaled to match — at any depth. A menu is added as one entry that contains all of its recipes.
      </p>
    </section>

    <section id="working-with-the-list">
      <h2>Working with the list</h2>
      <p>
        Open the list from the cart icon in the activity bar. The top half lists what you've added: change an entry's scale in the number box, or remove it with <strong>&times;</strong>. <strong>Clear All</strong> empties the list.
      </p>
      <p>
        Below are the ingredients. Tick one to cross it off; tick again to bring it back. When you remove a recipe, ticks for ingredients that are no longer needed are dropped.
      </p>
    </section>

    <section id="aisles-and-pantry">
      <h2>Aisles and pantry</h2>
      <p>
        Put a <code>config/aisle.conf</code> in your recipe folder to group ingredients by aisle, in the order you walk the shop:
      </p>
      <pre><code>[produce]
garlic
onion

[dairy]
butter
milk</code></pre>
      <p>
        Ingredients without an aisle appear under <strong>other</strong>. Anything listed in <code>config/pantry.conf</code> is left off the list and shown under <strong>In Pantry</strong> instead. The list updates as soon as you save either file.
      </p>
    </section>

    <section id="files">
      <h2>Where the list is stored</h2>
      <p>
        The list lives in two plain-text files at the top of your recipe folder: <code>.shopping-list</code> (what you've added, with scales) and <code>.shopping-checked</code> (what you've ticked). They're the same files <a href="https://cooklang.org/cli/">CookCLI</a> uses, so the list follows your folder wherever it syncs, and editing them by hand updates the panel.
      </p>
    </section>

    <section id="panel">
      <h2>Moving the panel</h2>
      <p>
        The list opens in the left sidebar. Drag its icon to the right sidebar if you prefer it next to the preview — Cook Editor remembers where you put it. If you'd rather not use the plugin, disable it in the Extensions view; the cart buttons go away and your list files stay on disk.
      </p>
    </section>
```

Bottom nav: prev → Overview (`help_plugins_path`), next → "Build your first plugin" (`help_plugins_getting_started_path`).

- [ ] **Step 3: Verify accuracy**

Against `plugins/shopping-list/package.json` (command titles, category "Shopping List", menus) and the E2E run: button placement, "Clear All", "In Pantry", that dragging the view container to the right sidebar works and persists. If dragging does not work in Theia, replace the "Moving the panel" paragraph's first two sentences with "The list opens in the left sidebar."

- [ ] **Step 4: Run spec and commit**

```bash
bundle exec rspec spec/requests/help/plugins_spec.rb
git add app/views/help/plugins/shopping_list.html.erb spec/requests/help/plugins_spec.rb
git commit -m "docs(help): shopping list plugin guide"
```

---

### Task 4: Build your first plugin page

**Files:** replace `getting_started.html.erb`; add spec example

- [ ] **Step 1: Spec**

```ruby
  describe "getting started content" do
    it "walks through the plugins repo, meal-journal and deploy" do
      get "/help/plugins/getting-started"
      expect(response.body).to include("github.com/cook-md/plugins")
      expect(response.body).to include("meal-journal")
      expect(response.body).to include("npm run deploy")
      expect(response.body).to include("cooklang.api.version")
    end
  end
```

- [ ] **Step 2: Page**

Title `"Build Your First Plugin"`, `current_page: :getting_started`, on-this-page `#introduction`, `#what-a-plugin-is`, `#start-from-the-example`, `#manifest`, `#calling-cooklang`, `#run-it`. Body:

```erb
    <section id="introduction">
      <h1>Build your first plugin</h1>
      <p class="text-lg" style="font-size: 1.125rem; color: #6b7280; margin-bottom: 2rem;">
        A Cook Editor plugin is a VS Code extension: a folder with a <code>package.json</code> that declares what it adds, and a TypeScript entry point with an <code>activate()</code> function. If you've written a VS Code extension before, everything you know applies.
      </p>
    </section>

    <section id="what-a-plugin-is">
      <h2>What a plugin can do</h2>
      <ul>
        <li>Everything in the <a href="https://code.visualstudio.com/api">VS Code Extension API</a> that Cook Editor supports (API 1.110): commands, menus, keybindings, settings, snippets, sidebar views and webviews, status bar items, file access.</li>
        <li>Call the <%= link_to "Cooklang API", help_plugins_api_path %> — parse shopping lists, resolve recipe references, build aisle-grouped lists — with the same Rust code the editor uses.</li>
        <li>Add buttons and menu items to Cooklang screens through <%= link_to "outlets", help_plugins_outlets_path %>, such as the recipe preview header.</li>
      </ul>
    </section>

    <section id="start-from-the-example">
      <h2>Start from the example</h2>
      <p>
        First-party plugins live in <a href="https://github.com/cook-md/plugins">github.com/cook-md/plugins</a>, one folder per plugin. <code>meal-journal</code> is the smallest complete example; <code>shopping-list</code> shows the Cooklang API, outlets and a webview.
      </p>
      <pre><code>git clone https://github.com/cook-md/plugins.git
cd plugins
cp -r meal-journal my-plugin
cd my-plugin
npm install</code></pre>
      <p>
        Keep logic that doesn't need the <code>vscode</code> module in its own files — you can test those with plain mocha (<code>npm test</code>), as both examples do.
      </p>
    </section>

    <section id="manifest">
      <h2>The manifest</h2>
      <p>Edit <code>package.json</code>. At minimum:</p>
      <pre><code>{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "0.1.0",
  "publisher": "your-namespace",
  "engines": { "vscode": "^1.100.0" },
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [{ "command": "myPlugin.hello", "title": "Say Hello", "category": "My Plugin" }],
    "menus": {
      "cooklang/recipePreview/toolbar": [{ "command": "myPlugin.hello", "group": "navigation@50" }]
    }
  }
}</code></pre>
      <p>
        That <code>menus</code> entry puts your command in the recipe preview header — see <%= link_to "Outlets", help_plugins_outlets_path %> for all the places you can add to.
      </p>
    </section>

    <section id="calling-cooklang">
      <h2>Calling Cooklang</h2>
      <p>
        The Cooklang API is a set of commands. Check the version when your plugin starts, then call what you need:
      </p>
      <pre><code>import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
  const version = await vscode.commands.executeCommand&lt;number&gt;('cooklang.api.version');
  if (version !== 1) {
    vscode.window.showWarningMessage('My Plugin needs a newer Cook Editor.');
    return;
  }
  context.subscriptions.push(vscode.commands.registerCommand('myPlugin.hello', async (ctx: { path: string; scale: number }) => {
    const list = await vscode.commands.executeCommand('cooklang.api.generateShoppingList', {
      recipes: [{ path: ctx.path, scale: ctx.scale }],
    });
    vscode.window.showInformationMessage(`Needs ${JSON.stringify(list)}`);
  }));
}</code></pre>
    </section>

    <section id="run-it">
      <h2>Run it in Cook Editor</h2>
      <p>
        Plugins load from the <code>plugins/</code> folder of a Cook Editor source checkout. The examples' <code>npm run deploy</code> builds the plugin and copies it there; restart the editor to pick it up. The loop is: edit → <code>npm run deploy</code> → restart.
      </p>
      <p>
        To try a packaged plugin in the installed app instead, run <code>npm run package</code> and install the <code>.vsix</code> from the Extensions view's <strong>&hellip;</strong> menu (<strong>Install from VSIX&hellip;</strong>).
      </p>
    </section>
```

Bottom nav: prev → Shopping List, next → Cooklang API.

- [ ] **Step 3: Verify accuracy**

Confirm against the plugins repo README: the deploy target path wording, the Node/`@types/vscode` pin, and that "Install from VSIX…" exists in the Extensions view menu of the built editor (if not, delete that paragraph).

- [ ] **Step 4: Run spec and commit**

```bash
bundle exec rspec spec/requests/help/plugins_spec.rb
git add app/views/help/plugins/getting_started.html.erb spec/requests/help/plugins_spec.rb
git commit -m "docs(help): build your first plugin"
```

---

### Task 5: Cooklang API reference page

**Files:** replace `api.html.erb`; add spec example

- [ ] **Step 1: Spec**

```ruby
  describe "api content" do
    it "documents every cooklang.api command" do
      get "/help/plugins/api"
      %w[
        cooklang.api.version cooklang.api.generateShoppingList cooklang.api.resolveRecipeReferences
        cooklang.api.parseShoppingList cooklang.api.writeShoppingList cooklang.api.parseShoppingChecked
        cooklang.api.writeShoppingChecked cooklang.api.compactShoppingChecked cooklang.apiVersion
      ].each { |name| expect(response.body).to include(name) }
    end
  end
```

- [ ] **Step 2: Page**

Title `"Cooklang API"`, `current_page: :api`, on-this-page `#introduction`, `#conventions`, `#version`, `#shopping-lists`, `#references`, `#list-files`. Body:

```erb
    <section id="introduction">
      <h1>Cooklang API</h1>
      <p class="text-lg" style="font-size: 1.125rem; color: #6b7280; margin-bottom: 2rem;">
        Cook Editor exposes its Cooklang features to plugins as commands. Call them with <code>vscode.commands.executeCommand(id, args)</code>. They run the same Rust code as the editor, so your plugin gets the same results as the built-in features.
      </p>
    </section>

    <section id="conventions">
      <h2>Conventions</h2>
      <ul>
        <li>Each command takes one JSON object and returns JSON.</li>
        <li>Paths are relative to the open recipe folder, e.g. <code>"Dinner/Carbonara.cook"</code>. Absolute paths and <code>file://</code> URIs inside the folder also work.</li>
        <li>Errors reject the promise with a readable message: <code>No workspace is open.</code>, <code>Recipe not found: …</code>, <code>Path is outside the workspace: …</code>, <code>Invalid arguments: …</code>.</li>
        <li>The commands don't appear in the command palette.</li>
      </ul>
    </section>

    <section id="version">
      <h2>Version</h2>
      <table>
        <thead><tr><th>Command</th><th>Arguments</th><th>Returns</th></tr></thead>
        <tbody>
          <tr><td><code>cooklang.api.version</code></td><td>—</td><td><code>1</code></td></tr>
        </tbody>
      </table>
      <p>
        Check it when your plugin activates. The same number is available to <code>when</code> clauses as the context key <code>cooklang.apiVersion</code>, e.g. <code>"when": "cooklang.apiVersion >= 1"</code>. Version 1 only grows: new commands and optional fields may appear, nothing is removed or renamed.
      </p>
    </section>

    <section id="shopping-lists">
      <h2>Shopping lists</h2>
      <table>
        <thead><tr><th>Command</th><th>Arguments</th><th>Returns</th></tr></thead>
        <tbody>
          <tr>
            <td><code>cooklang.api.generateShoppingList</code></td>
            <td><code>{ recipes: [{ path, scale? }] }</code></td>
            <td>
              <code>{ categories: [{ name, items: [{ name, quantities }] }], other: { name, items }, pantryItems: [name] }</code><br>
              Categories follow <code>config/aisle.conf</code>; items in <code>config/pantry.conf</code> are moved to <code>pantryItems</code>. Recipes that can't be found are skipped. Pass every recipe you want counted — sub-recipes are not expanded here (use <code>resolveRecipeReferences</code>).
            </td>
          </tr>
        </tbody>
      </table>
      <pre><code>const list = await vscode.commands.executeCommand('cooklang.api.generateShoppingList', {
  recipes: [{ path: 'Dinner/Carbonara.cook', scale: 2 }, { path: 'Bread.cook' }],
});</code></pre>
    </section>

    <section id="references">
      <h2>Recipe references</h2>
      <table>
        <thead><tr><th>Command</th><th>Arguments</th><th>Returns</th></tr></thead>
        <tbody>
          <tr>
            <td><code>cooklang.api.resolveRecipeReferences</code></td>
            <td><code>{ path }</code> — a <code>.cook</code> or <code>.menu</code></td>
            <td>
              <code>[{ path, scale, children? }]</code> — the <code>@recipe</code> references, followed recursively. <code>scale</code> is a multiplier relative to the recipe holding the reference; <code>{4%servings}</code> and yield units are already converted. A reference cycle is skipped.
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section id="list-files">
      <h2>The shopping-list files</h2>
      <p>
        <code>.shopping-list</code> and <code>.shopping-checked</code> are the files CookCLI and the Shopping List plugin share. Use these commands to read and write them instead of parsing the text yourself.
      </p>
      <table>
        <thead><tr><th>Command</th><th>Arguments</th><th>Returns</th></tr></thead>
        <tbody>
          <tr><td><code>cooklang.api.parseShoppingList</code></td><td><code>{ text }</code></td><td><code>{ items: [{ type: 'recipe', path, multiplier?, children }] }</code></td></tr>
          <tr><td><code>cooklang.api.writeShoppingList</code></td><td><code>{ list }</code> (that shape)</td><td>file text</td></tr>
          <tr><td><code>cooklang.api.parseShoppingChecked</code></td><td><code>{ text }</code></td><td><code>[{ type: 'checked' | 'unchecked', name }]</code> — later entries win</td></tr>
          <tr><td><code>cooklang.api.writeShoppingChecked</code></td><td><code>{ entries }</code></td><td>file text, one line per entry (append it to the file)</td></tr>
          <tr><td><code>cooklang.api.compactShoppingChecked</code></td><td><code>{ entries, ingredients: [name] }</code></td><td>the entries whose ingredient is still in <code>ingredients</code></td></tr>
        </tbody>
      </table>
    </section>
```

Bottom nav: prev → Build your first plugin, next → Outlets.

- [ ] **Step 3: Verify accuracy**

Against `cooklang-plugin-api-contribution.ts`: command ids, argument names, error strings. Against `generate`: confirm sub-recipes are not expanded by `generateShoppingList` (the generator takes a flat list — true in the plan's implementation). Confirm `cooklang.apiVersion >= 1` evaluates in a `when` clause in the running editor (put it on a test plugin's menu item); if numeric comparison is unsupported, change the example to `"when": "cooklang.apiVersion == 1"`.

- [ ] **Step 4: Run spec and commit**

```bash
bundle exec rspec spec/requests/help/plugins_spec.rb
git add app/views/help/plugins/api.html.erb spec/requests/help/plugins_spec.rb
git commit -m "docs(help): Cooklang API reference for plugins"
```

---

### Task 6: Outlets reference page (with screenshot)

**Files:** replace `outlets.html.erb`; create `app/assets/images/help/plugins/outlets.png`; add spec example

- [ ] **Step 1: Screenshot**

From the editor E2E setup (plugin plan Task 8 workspace), open `Pasta.cook`'s preview with the Shopping List plugin enabled, take a screenshot of the preview header and ingredients (macOS: `screencapture -i`), and annotate nothing — the page text explains it. Save as `web/app/assets/images/help/plugins/outlets.png` (≤ 1600 px wide; `sips -Z 1600 outlets.png`).

- [ ] **Step 2: Spec**

```ruby
  describe "outlets content" do
    it "lists every outlet with its context" do
      get "/help/plugins/outlets"
      %w[
        cooklang/recipePreview/toolbar cooklang/menuPreview/toolbar cooklang/recipePreview/ingredient/context
        cooklang/menuPreview/recipe/context cooklang/report/toolbar
      ].each { |outlet| expect(response.body).to include(outlet) }
      expect(response.body).to include("templateLabel")
      expect(response.body).to include("menuScale")
    end
  end
```

- [ ] **Step 3: Page**

Title `"Outlets"`, `current_page: :outlets`, on-this-page `#introduction`, `#how-it-works`, `#reference`, `#contexts`, `#examples`, `#tips`. Body:

```erb
    <section id="introduction">
      <h1>Outlets</h1>
      <p class="text-lg" style="font-size: 1.125rem; color: #6b7280; margin-bottom: 2rem;">
        Outlets are the places in Cook Editor's Cooklang screens where a plugin can add buttons and menu items — the recipe preview header, the menu preview, reports. You add to an outlet from <code>package.json</code>, the same way you add to VS Code's editor title bar.
      </p>
      <%= image_tag "help/plugins/outlets.png", alt: "Recipe preview header with a plugin's cart button next to Show Source", style: "max-width: 100%; border-radius: 8px; margin: 1rem 0;" %>
    </section>

    <section id="how-it-works">
      <h2>How it works</h2>
      <p>
        Declare your command, then list it under the outlet's id in <code>contributes.menus</code>. When the user clicks it, your command receives one argument: a JSON <em>context</em> describing what they clicked. Toolbar outlets show the command's icon (or its title if it has none); context-menu outlets show its title.
      </p>
      <p>
        <code>group</code> orders items: <code>"navigation@10"</code> puts your button in the main group at position 10. Cook Editor's own <strong>Show Source</strong> button sits at <code>navigation@90</code>, so lower numbers appear before it.
      </p>
    </section>

    <section id="reference">
      <h2>Outlet reference</h2>
      <table>
        <thead><tr><th>Outlet id</th><th>Where</th><th>Context</th></tr></thead>
        <tbody>
          <tr><td><code>cooklang/recipePreview/toolbar</code></td><td>Buttons in the recipe preview header</td><td>Preview</td></tr>
          <tr><td><code>cooklang/menuPreview/toolbar</code></td><td>Buttons in the menu preview header</td><td>Preview</td></tr>
          <tr><td><code>cooklang/recipePreview/ingredient/context</code></td><td>Right-click an ingredient in the recipe preview</td><td>Ingredient</td></tr>
          <tr><td><code>cooklang/menuPreview/recipe/context</code></td><td>Right-click a recipe in the menu preview</td><td>Menu recipe</td></tr>
          <tr><td><code>cooklang/report/toolbar</code></td><td>Buttons above a rendered report</td><td>Report</td></tr>
        </tbody>
      </table>
    </section>

    <section id="contexts">
      <h2>Contexts</h2>
      <p>Every context has <code>version: 1</code>. Paths are relative to the recipe folder; URIs are <code>file://</code> strings. Later versions only add optional fields.</p>
      <h3>Preview</h3>
      <pre><code>{ version: 1, uri: 'file:///…/Dinner/Carbonara.cook', path: 'Dinner/Carbonara.cook', scale: 2 }</code></pre>
      <p><code>scale</code> is the scale the preview is showing.</p>
      <h3>Ingredient</h3>
      <pre><code>{ version: 1, uri, path, scale,
  ingredient: { name: 'flour', quantity: '400 g', amount: 400, unit: 'g' } }</code></pre>
      <p><code>quantity</code> is the text shown in the preview, already scaled. <code>amount</code> is present when the quantity is a number; <code>unit</code> when it has one.</p>
      <h3>Menu recipe</h3>
      <pre><code>{ version: 1, menuUri, menuPath: 'Plans/Week.menu', menuScale: 1,
  recipe: { name: 'Dinner/Carbonara', scale: 2, unit: 'servings' } }</code></pre>
      <p>
        <code>recipe.name</code> is the reference as written in the menu. <code>scale</code> already includes the menu's scale. When <code>unit</code> is set, <code>scale</code> is a target in that unit (4 servings), not a multiplier — call <code>cooklang.api.resolveRecipeReferences</code> on the menu if you need multipliers.
      </p>
      <h3>Report</h3>
      <pre><code>{ version: 1, uri, path, templateId, templateLabel, templateUri?, outputFormat: 'markdown' | 'html' | 'text', output? }</code></pre>
      <p><code>output</code> is the rendered text, once rendering has succeeded.</p>
    </section>

    <section id="examples">
      <h2>Examples</h2>
      <pre><code>"contributes": {
  "commands": [
    { "command": "nutrition.lookup", "title": "Look Up Nutrition" },
    { "command": "share.report", "title": "Share Report", "icon": "$(share)" }
  ],
  "menus": {
    "cooklang/recipePreview/ingredient/context": [{ "command": "nutrition.lookup" }],
    "cooklang/report/toolbar": [{ "command": "share.report", "group": "navigation@10" }]
  }
}</code></pre>
      <pre><code>vscode.commands.registerCommand('nutrition.lookup', (ctx: { ingredient: { name: string; amount?: number; unit?: string } }) => {
  vscode.window.showInformationMessage(`${ctx.ingredient.name}: ${ctx.ingredient.amount ?? '?'} ${ctx.ingredient.unit ?? ''}`);
});</code></pre>
      <p>The <%= link_to "Shopping List plugin", help_plugins_shopping_list_path %> uses both preview toolbar outlets — its <code>package.json</code> is a complete example.</p>
    </section>

    <section id="tips">
      <h2>Tips</h2>
      <ul>
        <li>Hide your command from the command palette when it only makes sense with a context: add <code>{ "command": "…", "when": "false" }</code> under <code>menus.commandPalette</code>.</li>
        <li><code>when</code> clauses on outlet items are checked when the screen redraws. Use them for facts that don't change while a preview is open (like <code>cooklang.apiVersion</code>); put per-recipe decisions in your command, using the context.</li>
        <li>If an outlet has nothing in it, nothing is shown — right-click falls back to the normal menu.</li>
      </ul>
    </section>
```

Bottom nav: prev → Cooklang API, next → Publishing.

- [ ] **Step 4: Verify accuracy**

Against `cooklang-outlets.ts`, `cooklang-outlet-context.ts` and `cooklang-outlet-contribution.ts` (Show Source order `90`). Confirm `$(share)` renders as an icon on a toolbar outlet in the running editor (Theia maps `$(codicon)` command icons); if not, change the example to a light/dark SVG pair.

- [ ] **Step 5: Run spec and commit**

```bash
bundle exec rspec spec/requests/help/plugins_spec.rb
git add app/views/help/plugins/outlets.html.erb app/assets/images/help/plugins/outlets.png spec/requests/help/plugins_spec.rb
git commit -m "docs(help): outlets reference for plugins"
```

---

### Task 7: Publishing page

**Files:** replace `publishing.html.erb`; add spec example

- [ ] **Step 1: Spec**

```ruby
  describe "publishing content" do
    it "covers the namespace, PAT, packaging and the types pin" do
      get "/help/plugins/publishing"
      expect(response.body).to include("create-namespace")
      expect(response.body).to include("vsce package")
      expect(response.body).to include("ovsx publish")
      expect(response.body).to include("@types/vscode")
    end
  end
```

- [ ] **Step 2: Page**

Title `"Publishing Plugins"`, `current_page: :publishing`, on-this-page `#introduction`, `#one-time-setup`, `#package`, `#publish`, `#gotchas`. Body — take the steps from the plugins repo README's "Publishing to plugins.cook.md" section (read it first: `sed -n '/Publishing to plugins.cook.md/,$p' /Users/alexeydubovskoy/Cooklang/plugins/README.md`) and keep them identical:

```erb
    <section id="introduction">
      <h1>Publishing</h1>
      <p class="text-lg" style="font-size: 1.125rem; color: #6b7280; margin-bottom: 2rem;">
        Publish your plugin to <a href="https://plugins.cook.md">plugins.cook.md</a> and anyone can install it from Cook Editor's Extensions view. The marketplace speaks the Open VSX protocol, so the usual <code>vsce</code> and <code>ovsx</code> tools work.
      </p>
    </section>

    <section id="one-time-setup">
      <h2>One-time setup</h2>
      <ol>
        <li>Sign in at <a href="https://plugins.cook.md">plugins.cook.md</a> with GitHub and create a personal access token (PAT) in your dashboard.</li>
        <li>Create a namespace matching the <code>publisher</code> in your <code>package.json</code>:
          <pre><code>npx ovsx create-namespace your-namespace -r https://plugins.cook.md -p &lt;PAT&gt;</code></pre>
        </li>
      </ol>
    </section>

    <section id="package">
      <h2>Package</h2>
      <pre><code>npm version patch
npx vsce package --no-dependencies</code></pre>
      <p>This produces <code>my-plugin-0.1.1.vsix</code>. Install it from the Extensions view to test the exact file you're about to publish.</p>
    </section>

    <section id="publish">
      <h2>Publish</h2>
      <pre><code>npx ovsx publish --packagePath my-plugin-0.1.1.vsix -r https://plugins.cook.md -p &lt;PAT&gt;</code></pre>
      <p>The new version shows up in the Extensions view within a minute. Users with the plugin installed are offered the update.</p>
    </section>

    <section id="gotchas">
      <h2>Gotchas</h2>
      <ul>
        <li><strong><code>@types/vscode</code> newer than <code>engines.vscode</code>:</strong> <code>vsce</code> refuses to package. Pin it with a tilde to the same minor, e.g. <code>"@types/vscode": "~1.100.0"</code> with <code>"engines": { "vscode": "^1.100.0" }</code>.</li>
        <li><strong>Missing files in the package:</strong> check <code>.vscodeignore</code> — compiled output (<code>out/</code>) and any media your manifest points to must be included; sources and tests can be left out.</li>
        <li><strong>Depending on the Cooklang API:</strong> check <code>cooklang.api.version</code> on activation and tell the user to update Cook Editor if it's missing — older editors don't have it.</li>
      </ul>
    </section>
```

Bottom nav: prev → Outlets, empty next.

- [ ] **Step 3: Verify accuracy, run spec, commit**

Match commands and namespace instructions to the plugins README exactly.

```bash
bundle exec rspec spec/requests/help/plugins_spec.rb
git add app/views/help/plugins/publishing.html.erb spec/requests/help/plugins_spec.rb
git commit -m "docs(help): publishing plugins to plugins.cook.md"
```

---

### Task 8: Help index card and editor help fixes

**Files:** modify `app/views/help/help/index.html.erb`, `app/views/help/editor/features.html.erb`, `app/views/help/editor/getting_started.html.erb`, `spec/requests/help/index_spec.rb`, `spec/requests/help/editor_spec.rb`

- [ ] **Step 1: Specs (failing)**

In `spec/requests/help/index_spec.rb`, add (inside its `describe "GET /help"` block — check the file's structure first):

```ruby
    it "links to the plugins section" do
      get "/help"
      expect(response.body).to include(help_plugins_path)
    end
```

In `spec/requests/help/editor_spec.rb`, add:

```ruby
  describe "shopping list text" do
    it "describes the real flow and links to the plugin guide" do
      get "/help/editor/features"
      expect(response.body).to include("Add to Shopping List")
      expect(response.body).to include(help_plugins_shopping_list_path)
      expect(response.body).not_to include("open the <strong>Shopping</strong> panel")
      get "/help/editor/getting-started"
      expect(response.body).to include(help_plugins_shopping_list_path)
      expect(response.body).not_to include("open the <strong>Shopping</strong> panel")
    end
  end
```

Run: `bundle exec rspec spec/requests/help/index_spec.rb spec/requests/help/editor_spec.rb` → the new examples FAIL.

- [ ] **Step 2: Index card**

In `app/views/help/help/index.html.erb`, after the Report Templates card's `<% end %>`:

```erb
    <!-- Plugins -->
    <%= link_to help_plugins_path, class: "help-card" do %>
      <div class="help-card-icon">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z" />
        </svg>
      </div>
      <h2>Plugins</h2>
      <p>Add features to Cook Editor, use the built-in Shopping List, or build and publish your own plugin.</p>
    <% end %>
```

(The icon is Heroicons "puzzle-piece", the same icon set as the other cards.)

- [ ] **Step 3: Editor features page**

In `app/views/help/editor/features.html.erb`, replace the first `<p>` of `<section id="shopping">` (the "Select one or more recipes in the sidebar…" paragraph) with:

```erb
      <p>
        Click the cart button in a recipe or menu preview (or right-click the file in the explorer and choose <strong>Add to Shopping List</strong>) and open the list from the cart icon in the activity bar. Cook Editor merges the ingredient lists, combines duplicates (<code>@flour{200%g}</code> + <code>@flour{150%g}</code> becomes 350 g), and groups the result by aisle &mdash; produce, dairy, pantry, and so on. The shopping list is a plugin that comes with Cook Editor; see the <%= link_to "Shopping List guide", help_plugins_shopping_list_path %>.
      </p>
```

and in the second paragraph change "add or remove recipes from the selection and the list updates" to "add or remove recipes and the list updates". Keep the sync sentence as is.

- [ ] **Step 4: Editor getting-started page**

In `app/views/help/editor/getting_started.html.erb`, replace the first `<p>` of `<section id="shopping-list">` with:

```erb
      <p>
        With a recipe preview open, click the cart button in its header. The Shopping List opens in the sidebar with the ingredients combined and grouped by aisle. Add more recipes the same way — or a whole <code>.menu</code>. The <%= link_to "Shopping List guide", help_plugins_shopping_list_path %> covers scaling, ticking items off, and aisle and pantry files.
      </p>
```

- [ ] **Step 5: Run all help specs and lint**

Run: `bundle exec rspec spec/requests/help && bundle exec rubocop app/controllers/help/plugins_controller.rb config/routes.rb spec/requests/help`
Expected: all green, no offences.

- [ ] **Step 6: Commit**

```bash
git add app/views/help/help/index.html.erb app/views/help/editor/features.html.erb app/views/help/editor/getting_started.html.erb spec/requests/help/index_spec.rb spec/requests/help/editor_spec.rb
git commit -m "docs(help): plugins card; editor help describes the real shopping-list flow"
```

---

### Task 9: Visual check and PR

- [ ] **Step 1: Look at every page**

Run `bin/dev`, open http://localhost:3000/help/plugins and each sub-page. Check: sidebar highlights the current page, on-this-page anchors jump, tables and code blocks are readable, the screenshot loads, prev/next links chain Overview → Shopping List → Build → API → Outlets → Publishing, and `?content_only=true` renders without chrome.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feature/help-plugins
gh pr create --title "docs(help): /help/plugins section" --body "$(cat <<'EOF'
New /help/plugins section: overview, the default Shopping List plugin, building a plugin, the Cooklang API, outlets, and publishing to plugins.cook.md. Also fixes the editor help's shopping-list text, which described a flow that never existed.

Merge before or with cook-md/editor's plugin-outlets PR so its links resolve.
EOF
)"
```
