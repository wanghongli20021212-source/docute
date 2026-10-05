import {getFilenameByPath, getFileUrl} from '../../utils'

const textContent = value => {
  // Preserve code verbatim; its angle brackets and underscores are searchable.
  const parts = value.split(/(```[^\n]*\n[\s\S]*?```|`[^`\n]+`)/g)
  return parts
    .map(part => {
      if (part.startsWith('```')) {
        return part.replace(/^```[^\n]*\n|```$/g, '')
      }
      if (part.startsWith('`') && part.endsWith('`')) return part.slice(1, -1)
      return part
        .replace(/<[^>]*>/g, ' ')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^ {0,3}#{1,6}\s+/gm, '')
        .replace(/(\*\*|__)([\s\S]+?)\1/g, '$2')
        .replace(/(^|\s)[*_]([^*\n_]+)[*_](?=$|\s|[.,!?])/g, '$1$2')
        .replace(/~~([^~]+)~~/g, '$1')
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

const escapeText = value =>
  value.replace(/[&<>"']/g, character => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]
  })

// Read the current sidebar, including legacy `links` and nested groups.
export function collectPages(sidebar) {
  const pages = []
  const links = new Set()
  const visited = new Set()

  const visit = items => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (!item || typeof item !== 'object' || visited.has(item)) continue
      visited.add(item)
      const {link, title} = item
      if (
        typeof link === 'string' &&
        typeof title === 'string' &&
        !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(link) &&
        !links.has(link)
      ) {
        links.add(link)
        pages.push({title: textContent(title), link})
      }
      visit(item.children || item.links)
    }
  }

  visit(sidebar)
  return pages
}

export default function localSearch({
  maxResults = 10,
  onError = () => {}
} = {}) {
  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new TypeError('localSearch maxResults must be a positive integer')
  }

  return {
    name: 'local-search',
    extend(api) {
      const cache = new Map()
      const queue = []
      let active = 0
      let previousSourcePath
      let previousFetchOptions
      let previousRoutes

      const runQueue = () => {
        while (active < 4 && queue.length) {
          const {url, fetchOptions, resolve, reject} = queue.shift()
          active++
          Promise.resolve()
            .then(() => fetch(url, fetchOptions))
            .then(response => {
              if (!response.ok) {
                throw new Error(`Unable to index ${url}: ${response.status}`)
              }
              return response.text()
            })
            .then(textContent)
            .then(resolve, reject)
            .then(() => {
              active--
              runQueue()
            })
        }
      }

      const loadPage = async (page, config) => {
        const pathname = page.link.split(/[?#]/)[0]
        const route = (config.routes && config.routes[pathname]) || {}
        if (typeof route.content === 'string') return textContent(route.content)
        const url =
          route.file ||
          getFileUrl(config.sourcePath, getFilenameByPath(pathname))
        if (!cache.has(url)) {
          const content = new Promise((resolve, reject) => {
            queue.push({
              url,
              fetchOptions: config.fetchOptions,
              resolve,
              reject
            })
            runQueue()
          })
          cache.set(url, content)
        }
        const content = cache.get(url)
        try {
          return await content
        } catch (error) {
          // A later query can retry this page; its title remains searchable.
          if (cache.get(url) === content) cache.delete(url)
          onError(error, page)
          return ''
        }
      }

      api.enableSearch({
        async handler(keyword) {
          const query = keyword.trim().toLowerCase()
          if (!query) return []
          const terms = query.split(/\s+/)
          const {config, sidebar} = api.store.getters
          if (
            previousSourcePath !== config.sourcePath ||
            previousFetchOptions !== config.fetchOptions ||
            previousRoutes !== config.routes
          ) {
            cache.clear()
            previousSourcePath = config.sourcePath
            previousFetchOptions = config.fetchOptions
            previousRoutes = config.routes
          }
          const pages = collectPages(sidebar)
          const documents = await Promise.all(
            pages.map(page => loadPage(page, config))
          )

          return pages
            .map((page, index) => {
              const title = page.title.toLowerCase()
              const content = documents[index]
              const searchable = `${title} ${content.toLowerCase()}`
              if (!terms.every(term => searchable.includes(term))) return null
              const firstMatch = content.toLowerCase().indexOf(terms[0])
              const start = Math.max(0, firstMatch - 40)
              return {
                title: escapeText(page.title),
                link: page.link,
                description: escapeText(content.slice(start, start + 160)),
                score: terms.filter(term => title.includes(term)).length,
                index
              }
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || a.index - b.index)
            .slice(0, maxResults)
            .map(({title, link, description}) => ({title, link, description}))
        }
      })
    }
  }
}
