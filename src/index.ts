// Main exports for ts-lsp-mcp

// Server
export { createMcpServer, shutdownServer } from './server/mcp-server.js';
export { startStdioServer } from './server/transports/stdio.js';
export { startHttpServer } from './server/transports/http-sse.js';

// TypeScript utilities
export { LanguageServiceWrapper } from './typescript/language-service.js';
export type { LanguageServiceOptions } from './typescript/language-service.js';
export { ProjectManager, getProjectManager, disposeProjectManager } from './typescript/project-manager.js';
export type { ProjectContext } from './typescript/project-manager.js';
export { FileResolver } from './typescript/file-resolver.js';
export {
  positionToOffset,
  offsetToPosition,
  textSpanToRange,
  getLinePreview,
  isValidPosition,
} from './typescript/position-utils.js';
export type { Position, Range } from './typescript/position-utils.js';
export {
  serializeType,
  getSymbolKind,
  formatDiagnostic,
} from './typescript/type-serializer.js';
export type { SerializeOptions, TypeInfo } from './typescript/type-serializer.js';

// Type tests
export { parseTypeTests, typesEqual, normalizeTypeString } from './type-tests/parser.js';
export type { TypeTestAssertion } from './type-tests/parser.js';
export { runTypeTests } from './type-tests/runner.js';
export type { TypeTestResult, TypeTestSummary } from './type-tests/runner.js';

// Utilities
export { findTsConfig, findAllTsConfigs, getProjectRoot } from './utils/tsconfig-finder.js';
export { logger, setLogLevel, getLogLevel } from './utils/logger.js';
