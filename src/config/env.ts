// Environment Configuration Loader
// Loads environment variables from .env and .env.local files
// .env.local takes precedence for local development overrides

import { config } from 'dotenv'

// Load .env first (base configuration)
config()

// Load .env.local second (overrides .env for local development)
config({ path: '.env.local', override: true })

// Export for easy importing in other modules
export const loadEnv = () => {
  // Already loaded above, this is just a convenience export
}
