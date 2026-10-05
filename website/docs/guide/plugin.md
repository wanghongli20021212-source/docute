# Plugin

A plugin is essentially a pure object:

```js
const showAuthor = {
  // Plugin name
  name: 'showAuthor',
  // Extend core features
  extend(api) {
    api.processMarkdown(text => {
      return text.replace(/{author}/g, '> Written by EGOIST')
    })
  }
}

new Docute({
  // ...
  plugins: [
    showAuthor
  ]
})
```

Example:

```markdown
# Page Title

{author}
```

<ImageZoom :border="true" src="https://i.loli.net/2018/09/28/5bae278dd9c03.png" />

---

To accept options in your plugin, you can use a factory function:

```js
const myPlugin = opts => {
  return {
    name: 'my-plugin',
    extend(api) {
      // do something with `opts` and `api`
    }
  }
}

new Docute({
  plugins: [
    myPlugin({ foo: true })
  ]
})
```

---

For more information on how to develop a plugin, please check out [Plugin API](/plugin-api).

## Local search

Enable local search without a hosted search service:

```js
new Docute({
  sidebar: [
    {title: 'Guide', children: [{title: 'Getting started', link: '/guide'}]}
  ],
  plugins: [Docute.localSearch({maxResults: 10})]
})
```

The plugin searches titles and page text from the current sidebar, including
nested groups and the legacy `links` property. All query words must occur in
the title or text; title matches rank first. Results link to their original
routes. An empty query returns no results.

Markdown is loaded on the first non-empty query, with at most four loads in
flight, and cached for later queries. The plugin uses the same `sourcePath`,
`fetchOptions`, and `routes` overrides as normal page navigation. Inline route
`content` is searched without a request. Changing language or sidebar uses the
current pages. Changing `sourcePath` or replacing the `fetchOptions` or `routes`
object clears the cache. Replace those objects instead of changing them in place
when you need to refresh already fetched text.

Only pages listed in the sidebar are indexed; external navigation links are
excluded. This is a text search, not a Markdown renderer: it does not execute
page components or apply custom Markdown hooks. Search snippets show plain
text. If a page fails to load, its title remains searchable and a later query
can retry the text. Use `onError(error, page)` to report indexing failures:

```js
Docute.localSearch({
  maxResults: 5,
  onError(error, page) {
    console.warn(`Could not search ${page.link}`, error)
  }
})
```

Check out [https://github.com/egoist/docute-plugins](https://github.com/egoist/docute-plugins) for a list of Docute plugins by the maintainers and users.
