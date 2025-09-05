- paste in images - seems to work but requires more testing
- specify a locally hosted model
- specify a model hosted outside of Vertex Model Garden
- create files automatically with this output
```text
**src/environments/environment.ts**
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8000/api',
  wsUrl: 'ws://localhost:8000/ws'
};
```
```
