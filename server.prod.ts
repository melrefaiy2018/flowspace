// Production entry — sets env BEFORE dynamically importing the main server.
// Must use dynamic import (not static) because ES module imports are hoisted
// and evaluate before the importing module's body runs.
process.env.NODE_ENV = 'production';
process.env.FLOWSPACE_PRODUCTION = '1';
await import('./server.ts');
