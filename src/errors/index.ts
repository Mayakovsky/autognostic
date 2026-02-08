export {
  AutognosticError,
  ErrorCode,
  wrapError,
  isAutognosticError,
  getErrorCode,
  type ErrorContext,
  type SerializedError,
} from "./AutognosticError";

export { AutognosticNetworkError } from "./NetworkError";
export { AutognosticDatabaseError } from "./DatabaseError";
export { AutognosticValidationError } from "./ValidationError";
export { AutognosticClassificationError } from "./ClassificationError";
export { AutognosticStorageError } from "./StorageError";

// Re-export existing auth error for consistency
export { AutognosticAuthError } from "../auth/validateToken";
