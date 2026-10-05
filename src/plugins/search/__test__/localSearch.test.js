/* global global */
import assert from 'assert'
import localSearch, {collectPages} from '../localSearch'

const environment = typeof window === 'undefined' ? global : window

async function withSearch(
  {sidebar = [], config = {}, options = {}, fetcher},
  run
) {
  const previousFetch = environment.fetch
  const api = {
    store: {getters: {sidebar, config}},
    enableSearch(search) {
      this.search = search
      this.search.enabled = true
    }
  }
  environment.fetch =
    fetcher || (() => Promise.reject(new Error('No request expected')))
  localSearch(options).extend(api)
  try {
    await run(api.search.handler, api)
  } finally {
    environment.fetch = previousFetch
  }
}

const response = text => ({ok: true, text: async () => text})

describe('local search plugin', () => {
  it('collects nested and legacy navigation without duplicates or group headings', () => {
    const one = {title: 'One', link: '/one'}
    const sidebar = [
      null,
      {
        title: 'Group',
        children: [
          one,
          {
            title: 'Nested',
            links: [{title: 'Two', link: '/two'}, one]
          }
        ]
      },
      {title: 'External', link: 'https://example.com'},
      {title: 'Fragment', link: '#intro'},
      {title: 'Protocol-relative', link: '//example.com'}
    ]
    assert.deepStrictEqual(collectPages(sidebar), [
      {title: 'One', link: '/one'},
      {title: 'Two', link: '/two'}
    ])
  })

  it('handles unavailable navigation and cyclic groups', () => {
    const group = {title: 'Group', children: [{title: 'One', link: '/one'}]}
    group.children.push(group)
    assert.deepStrictEqual(collectPages(undefined), [])
    assert.deepStrictEqual(collectPages([group]), [
      {title: 'One', link: '/one'}
    ])
  })

  it('registers the existing search API and does not load pages for an empty query', async () => {
    await withSearch(
      {sidebar: [{title: 'Guide', link: '/guide'}]},
      async (search, api) => {
        assert.strictEqual(api.search.enabled, true)
        assert.deepStrictEqual(await search('   '), [])
      }
    )
  })

  it('finds text that is absent from the navigation title and caches page loads', async () => {
    let requests = 0
    await withSearch(
      {
        sidebar: [{title: 'Guide', link: '/guide'}],
        config: {sourcePath: '/docs/'},
        fetcher(url) {
          requests++
          assert.strictEqual(url, '/docs/guide.md')
          return Promise.resolve(response('# Guide\nWelcome to local search.'))
        }
      },
      async search => {
        const results = await search('LOCAL search')
        assert.strictEqual(results[0].link, '/guide')
        assert(results[0].description.includes('Welcome to local search.'))
        assert.strictEqual((await search('Welcome')).length, 1)
        assert.strictEqual(requests, 1)
      }
    )
  })

  it('requires every query word, ranks title matches first and caps results', async () => {
    await withSearch(
      {
        sidebar: [
          {title: 'Overview', link: '/a'},
          {title: 'Local search', link: '/b'},
          {title: 'Search tips', link: '/c'}
        ],
        config: {
          routes: {
            '/a': {content: 'local search'},
            '/b': {content: 'search'},
            '/c': {content: 'local search'}
          }
        },
        options: {maxResults: 2}
      },
      async search => {
        assert.deepStrictEqual(
          (await search('local search')).map(page => page.link),
          ['/b', '/c']
        )
        assert.deepStrictEqual(await search('local missing'), [])
      }
    )
  })

  it('searches inline route content without requesting it', async () => {
    await withSearch(
      {
        sidebar: [{title: 'Example', link: '/inline'}],
        config: {routes: {'/inline': {content: '# 日本語\n検索の例'}}}
      },
      async search => {
        assert.strictEqual((await search('検索'))[0].link, '/inline')
      }
    )
  })

  it('honors route file overrides, fetchOptions and original fragment links', async () => {
    const fetchOptions = {headers: {Accept: 'text/markdown'}}
    await withSearch(
      {
        sidebar: [{title: 'Guide', link: '/guide#intro'}],
        config: {fetchOptions, routes: {'/guide': {file: '/manual.md'}}},
        fetcher(url, options) {
          assert.strictEqual(url, '/manual.md')
          assert.strictEqual(options, fetchOptions)
          return Promise.resolve(response('Introduction'))
        }
      },
      async search =>
        assert.strictEqual(
          (await search('Introduction'))[0].link,
          '/guide#intro'
        )
    )
  })

  it('shares one fetched file between fragment destinations', async () => {
    let requests = 0
    await withSearch(
      {
        sidebar: [
          {title: 'One', link: '/guide#one'},
          {title: 'Two', link: '/guide#two'}
        ],
        fetcher() {
          requests++
          return Promise.resolve(response('shared text'))
        }
      },
      async search => {
        assert.strictEqual((await search('shared')).length, 2)
        assert.strictEqual(requests, 1)
      }
    )
  })

  it('uses the current sidebar after a language or navigation change', async () => {
    await withSearch(
      {
        sidebar: [{title: 'Guide', link: '/guide'}],
        config: {
          routes: {
            '/guide': {content: 'English'},
            '/zh/guide': {content: '中文'}
          }
        }
      },
      async (search, api) => {
        assert.strictEqual((await search('English')).length, 1)
        api.store.getters.sidebar = [{title: '指南', link: '/zh/guide'}]
        assert.deepStrictEqual(await search('English'), [])
        assert.strictEqual((await search('中文'))[0].link, '/zh/guide')
      }
    )
  })

  it('invalidates fetched text when the source configuration changes', async () => {
    const urls = []
    await withSearch(
      {
        sidebar: [{title: 'Guide', link: '/guide'}],
        config: {sourcePath: '/one'},
        fetcher(url) {
          urls.push(url)
          return Promise.resolve(response(url))
        }
      },
      async (search, api) => {
        assert.strictEqual((await search('/one')).length, 1)
        api.store.getters.config = {sourcePath: '/two'}
        assert.strictEqual((await search('/two')).length, 1)
        assert.deepStrictEqual(await search('/one'), [])
        assert.deepStrictEqual(urls, ['/one/guide.md', '/two/guide.md'])
      }
    )
  })

  it('keeps the title searchable on failed loading and retries on a later query', async () => {
    let requests = 0
    const errors = []
    await withSearch(
      {
        sidebar: [{title: 'Guide', link: '/guide'}],
        options: {
          onError(error, page) {
            errors.push([error.message, page.link])
          }
        },
        fetcher() {
          requests++
          return Promise.resolve(
            requests === 1
              ? {ok: false, status: 503}
              : response('Recovered body')
          )
        }
      },
      async search => {
        assert.strictEqual((await search('Guide')).length, 1)
        assert.strictEqual(errors.length, 1)
        assert.strictEqual(errors[0][1], '/guide')
        assert.strictEqual((await search('Recovered'))[0].link, '/guide')
        assert.strictEqual(requests, 2)
      }
    )
  })

  it('bounds initial indexing concurrency to four loads', async () => {
    let active = 0
    let peak = 0
    await withSearch(
      {
        sidebar: Array.from({length: 9}, (_, index) => ({
          title: `Page ${index}`,
          link: `/p${index}`
        })),
        fetcher() {
          active++
          peak = Math.max(active, peak)
          return new Promise(resolve =>
            setTimeout(() => {
              active--
              resolve(response('shared'))
            }, 5)
          )
        }
      },
      async search => {
        assert.strictEqual((await search('shared')).length, 9)
        assert.strictEqual(peak, 4)
      }
    )
  })

  it('returns plain-text snippets and literal punctuation for the result renderer', async () => {
    await withSearch(
      {
        sidebar: [{title: 'A & B', link: '/guide'}],
        config: {
          routes: {
            '/guide': {
              content: '**Notes**: [fish & chips](https://example.com)'
            }
          }
        }
      },
      async search => {
        const result = (await search('fish'))[0]
        assert.strictEqual(result.title, 'A &amp; B')
        assert.strictEqual(result.description, 'Notes: fish &amp; chips')
      }
    )
  })

  it('keeps code identifiers and literal punctuation searchable', async () => {
    await withSearch(
      {
        sidebar: [{title: 'API', link: '/api'}],
        config: {
          routes: {
            '/api': {content: '# API\nUse `get_file_url` and a C# example.'}
          }
        }
      },
      async search => {
        assert.strictEqual((await search('get_file_url'))[0].link, '/api')
        assert.strictEqual((await search('C#'))[0].link, '/api')
      }
    )
  })

  it('preserves double underscores and generic types in inline and fenced code', async () => {
    await withSearch(
      {
        sidebar: [{title: 'API', link: '/api'}],
        config: {
          routes: {
            '/api': {
              content:
                'Use `__DOCUTE_VERSION__` and `Array<T>`.\n```ts\nPromise<string>\n```'
            }
          }
        }
      },
      async search => {
        await Promise.all(
          ['__DOCUTE_VERSION__', 'Array<T>', 'Promise<string>'].map(
            async keyword => {
              assert.strictEqual((await search(keyword))[0].link, '/api')
            }
          )
        )
      }
    )
  })

  it('shares the four-load bound across overlapping queries and language changes', async () => {
    let active = 0
    let peak = 0
    const pages = prefix =>
      Array.from({length: 6}, (_, index) => ({
        title: `Page ${index}`,
        link: `/${prefix}${index}`
      }))
    await withSearch(
      {
        sidebar: pages('a'),
        fetcher() {
          active++
          peak = Math.max(active, peak)
          return new Promise(resolve =>
            setTimeout(() => {
              active--
              resolve(response('shared'))
            }, 5)
          )
        }
      },
      async (search, api) => {
        const first = search('shared')
        api.store.getters.sidebar = pages('b')
        const second = search('shared')
        assert.strictEqual((await first).length, 6)
        assert.strictEqual((await second).length, 6)
        assert.strictEqual(peak, 4)
      }
    )
  })

  it('rejects invalid result limits', () => {
    for (const maxResults of [0, -1, 1.5, '10']) {
      assert.throws(() => localSearch({maxResults}), /positive integer/)
    }
  })
})
