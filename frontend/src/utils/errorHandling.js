// @title: Gestion d'Erreurs Web3 avec Mapping Solidity → UI
// @security: User-friendly error messages, no exposing sensitive info
// @features: Error categorization, recovery suggestions

import { toast } from 'react-toastify';

// Common Web3 error patterns
const ERROR_PATTERNS = {
  // User rejection
  'user rejected': {
    category: 'user',
    message: 'Transaction rejected by user',
    severity: 'info',
    recovery: 'Please approve the transaction to continue'
  },
  
  // Insufficient funds
  'insufficient funds': {
    category: 'funds',
    message: 'Insufficient funds for transaction',
    severity: 'error',
    recovery: 'Add more funds to your wallet'
  },
  
  // Gas issues
  'gas required exceeds allowance': {
    category: 'gas',
    message: 'Insufficient gas for transaction',
    severity: 'warning',
    recovery: 'Increase gas limit or try again'
  },
  
  'always failing transaction': {
    category: 'execution',
    message: 'Transaction will fail',
    severity: 'error',
    recovery: 'Check your parameters and try again'
  },
  
  // Network issues
  'network error': {
    category: 'network',
    message: 'Network connection failed',
    severity: 'error',
    recovery: 'Check your internet connection'
  },
  
  // Contract-specific errors (from revert strings)
  'Position not found': {
    category: 'position',
    message: 'Position does not exist',
    severity: 'error',
    recovery: 'Refresh your positions and try again'
  },
  
  'Insufficient collateral': {
    category: 'margin',
    message: 'Insufficient collateral for position',
    severity: 'error',
    recovery: 'Add more collateral or reduce position size'
  },
  
  'Health factor too low': {
    category: 'risk',
    message: 'Position would be too risky',
    severity: 'error',
    recovery: 'Increase collateral or reduce leverage'
  },
  
  'Oracle price stale': {
    category: 'oracle',
    message: 'Price data is not up to date',
    severity: 'warning',
    recovery: 'Wait for oracle update or try another market'
  },
  
  'Market not active': {
    category: 'market',
    message: 'Market is not currently active',
    severity: 'warning',
    recovery: 'Try another market or check market status'
  },
  
  'Circuit breaker triggered': {
    category: 'emergency',
    message: 'Trading temporarily paused',
    severity: 'error',
    recovery: 'Trading will resume when conditions normalize'
  },
  
  // Default fallback
  'default': {
    category: 'unknown',
    message: 'Transaction failed',
    severity: 'error',
    recovery: 'Please try again or contact support'
  }
};

// Parse Solidity revert error
export const parseSolidityError = (errorString) => {
  if (!errorString) return ERROR_PATTERNS.default;
  
  const lowerError = errorString.toLowerCase();
  
  // Check for known patterns
  for (const [pattern, errorInfo] of Object.entries(ERROR_PATTERNS)) {
    if (lowerError.includes(pattern.toLowerCase())) {
      return errorInfo;
    }
  }
  
  // Check for revert with custom error
  const revertMatch = errorString.match(/reverted with reason string '([^']+)'/);
  if (revertMatch) {
    const reason = revertMatch[1];
    return {
      category: 'contract',
      message: reason,
      severity: 'error',
      recovery: 'Check contract conditions and try again'
    };
  }
  
  // Check for custom error signature
  const customErrorMatch = errorString.match(/error: ([^\n]+)/);
  if (customErrorMatch) {
    return {
      category: 'contract',
      message: customErrorMatch[1],
      severity: 'error',
      recovery: 'Check transaction parameters'
    };
  }
  
  return ERROR_PATTERNS.default;
};

// Handle Web3 error and show appropriate toast
export const handleWeb3Error = (error, context = 'Transaction') => {
  console.error(`${context} error:`, error);
  
  let errorInfo = ERROR_PATTERNS.default;
  let errorMessage = error.message || error.toString();
  
  // Parse the error
  errorInfo = parseSolidityError(errorMessage);
  
  // Show toast notification
  const toastConfig = {
    position: 'top-right',
    autoClose: 5000,
    hideProgressBar: false,
    closeOnClick: true,
    pauseOnHover: true,
    draggable: true
  };
  
  switch (errorInfo.severity) {
    case 'info':
      toast.info(`${context}: ${errorInfo.message}`, toastConfig);
      break;
    case 'warning':
      toast.warning(`${context}: ${errorInfo.message}`, toastConfig);
      break;
    case 'error':
    default:
      toast.error(`${context}: ${errorInfo.message}`, toastConfig);
      break;
  }
  
  // Return structured error for UI
  return {
    ...errorInfo,
    rawError: error,
    timestamp: Date.now(),
    context
  };
};

// Check if error is recoverable
export const isRecoverableError = (error) => {
  const errorInfo = parseSolidityError(error.message || error.toString());
  
  const recoverableCategories = ['user', 'gas', 'network', 'oracle', 'market'];
  return recoverableCategories.includes(errorInfo.category);
};

// Get recovery suggestion
export const getRecoverySuggestion = (error) => {
  const errorInfo = parseSolidityError(error.message || error.toString());
  return errorInfo.recovery;
};

// Log error for monitoring
export const logError = (error, metadata = {}) => {
  const errorInfo = parseSolidityError(error.message || error.toString());
  
  const errorLog = {
    ...errorInfo,
    metadata,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    url: window.location.href
  };
  
  // In production, send to error tracking service
  if (process.env.NODE_ENV === 'production') {
    // Send to Sentry/LogRocket/etc
    console.log('Error logged:', errorLog);
  } else {
    console.error('Development error:', errorLog);
  }
  
  return errorLog;
};

// Handle multiple errors
export const handleMultipleErrors = (errors, context = 'Batch operation') => {
  const handledErrors = errors.map(error => handleWeb3Error(error, context));
  
  // Group by category
  const errorsByCategory = handledErrors.reduce((acc, error) => {
    if (!acc[error.category]) {
      acc[error.category] = [];
    }
    acc[error.category].push(error);
    return acc;
  }, {});
  
  // Show summary toast
  if (handledErrors.length > 0) {
    const categories = Object.keys(errorsByCategory);
    toast.warning(
      `${context} completed with ${handledErrors.length} error(s) in categories: ${categories.join(', ')}`,
      { autoClose: 7000 }
    );
  }
  
  return {
    errors: handledErrors,
    byCategory: errorsByCategory,
    hasErrors: handledErrors.length > 0,
    isFullySuccessful: handledErrors.length === 0
  };
};

// Export utilities
export default {
  parseSolidityError,
  handleWeb3Error,
  isRecoverableError,
  getRecoverySuggestion,
  logError,
  handleMultipleErrors,
  ERROR_PATTERNS
};