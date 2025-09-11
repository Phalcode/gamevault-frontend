export interface HttpClientInit {
  getBaseUrl: () => string | undefined
  getAccessToken: () => string | undefined
}

export class HttpClient {
  private getBaseUrl: HttpClientInit['getBaseUrl']
  private getAccessToken: HttpClientInit['getAccessToken']

  constructor({ getBaseUrl, getAccessToken }: HttpClientInit) {
    this.getBaseUrl = getBaseUrl
    this.getAccessToken = getAccessToken
  }

  buildUrl(path: string): string {
    const base = this.getBaseUrl()?.replace(/\/+$/, '') || ''
    return `${base}${path}`
  }

  async request(
    path: string,
    options: RequestInit & { method?: string } = {}
  ): Promise<Response> {
    const { method = 'GET', headers: incomingHeaders, ...rest } = options
    const token = this.getAccessToken()

    // Normalize to a Headers instance so we can safely mutate.
    const headers = new Headers(incomingHeaders)

    // Ensure Accept header (do not overwrite if caller specified one).
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json')
    }

    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    return fetch(this.buildUrl(path), {
      method,
      headers,
      ...rest,
    })
  }

  async get(path: string, options?: Omit<RequestInit, 'method'>) {
    return this.request(path, { method: 'GET', ...(options || {}) })
  }

  async getJson<T>(path: string, options?: Omit<RequestInit, 'method'>): Promise<T> {
    const res = await this.get(path, options)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`GET ${path} failed (${res.status}): ${text || res.statusText}`)
    }
    return res.json() as Promise<T>
  }
}