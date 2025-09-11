import { AuthTokens, User } from '../types/api'
import { HttpClient } from './httpClient'

export class AuthService {
  constructor(private httpClient: HttpClient) {}

  async loginBasic(username: string, password: string): Promise<AuthTokens> {
    const res = await fetch(
      this.httpClient.buildUrl('/api/auth/basic/login'),
      {
        method: 'GET',
        headers: {
          Authorization: 'Basic ' + btoa(`${username}:${password}`),
          Accept: 'application/json',
        },
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Login failed (${res.status}): ${text || res.statusText}`)
    }
    return res.json()
  }

  async getCurrentUser(): Promise<User> {
    return this.httpClient.getJson<User>('/api/users/me')
  }
}