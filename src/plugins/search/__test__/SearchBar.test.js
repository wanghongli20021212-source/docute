import assert from 'assert'
import SearchBar from '../SearchBar.vue'

describe('search result ordering', () => {
  it('does not replace the latest results with an earlier slow query', async () => {
    const pending = {}
    const vm = {
      searchId: 1,
      result: [],
      $pluginApi: {
        search: {
          handler: keyword =>
            new Promise(resolve => {
              pending[keyword] = resolve
            })
        }
      }
    }
    const oldSearch = SearchBar.methods.search.call(vm, 'old', 1)
    vm.searchId = 2
    const newSearch = SearchBar.methods.search.call(vm, 'new', 2)
    pending.new([{title: 'New', link: '/new'}])
    await newSearch
    pending.old([{title: 'Old', link: '/old'}])
    await oldSearch
    assert.deepStrictEqual(vm.result, [{title: 'New', link: '/new'}])
  })

  it('invalidates a pending query as soon as a new input is received', async () => {
    let resolveRequest
    const calls = []
    const vm = {
      searchId: 1,
      result: [],
      $pluginApi: {
        search: {
          handler: () =>
            new Promise(resolve => {
              resolveRequest = resolve
            })
        }
      },
      debouncedSearch(keyword, id) {
        calls.push([keyword, id])
      }
    }
    const pending = SearchBar.methods.search.call(vm, 'old', 1)
    SearchBar.methods.handleSearch.call(vm, {target: {value: 'new'}})
    resolveRequest([{title: 'Old', link: '/old'}])
    await pending
    assert.deepStrictEqual(vm.result, [])
    assert.deepStrictEqual(calls, [['new', 2]])
  })

  it('clears results and invalidates a pending query on route or language navigation', async () => {
    let resolveRequest
    const vm = {
      searchId: 1,
      focused: true,
      result: [{title: 'English', link: '/guide'}],
      $pluginApi: {
        search: {
          handler: () =>
            new Promise(resolve => {
              resolveRequest = resolve
            })
        }
      }
    }
    const pending = SearchBar.methods.search.call(vm, 'English', 1)
    SearchBar.watch['$route.fullPath'].call(vm)
    assert.strictEqual(vm.focused, false)
    assert.deepStrictEqual(vm.result, [])
    resolveRequest([{title: 'English', link: '/guide'}])
    await pending
    assert.deepStrictEqual(vm.result, [])
  })
})
