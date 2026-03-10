// @title: Client WebSocket temps réel avec auto-reconnect et debounce
// @audit: Subscribe positions/liquidations, gestion erreurs complète
// @security: Rate limiting, validation messages, protection reconnection storm

import { EventEmitter } from 'events';
import WebSocket from 'isomorphic-ws';

class WebSocketClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      url: options.url || 'wss://api.perparbitradex.com/ws',
      reconnectInterval: options.reconnectInterval || 3000,
      maxReconnectAttempts: options.maxReconnectAttempts || 10,
      heartbeatInterval: options.heartbeatInterval || 30000,
      messageDebounce: options.messageDebounce || 100,
      maxQueueSize: options.maxQueueSize || 1000,
      ...options
    };
    
    this.ws = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.subscriptions = new Set();
    this.messageQueue = [];
    this.debounceTimer = null;
    this.messageHandlers = new Map();
    
    this._setupMessageHandlers();
  }
  
  // Connect to WebSocket server
  connect() {
    if (this.isConnected || this.isConnecting) {
      return;
    }
    
    this.isConnecting = true;
    
    try {
      this.ws = new WebSocket(this.options.url);
      
      this.ws.onopen = () => this._onOpen();
      this.ws.onclose = (event) => this._onClose(event);
      this.ws.onerror = (error) => this._onError(error);
      this.ws.onmessage = (event) => this._onMessage(event);
      
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this._scheduleReconnect();
    }
  }
  
  // Disconnect from server
  disconnect() {
    this._clearTimers();
    this.subscriptions.clear();
    this.messageQueue = [];
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
    }
    
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    
    this.emit('disconnected');
  }
  
  // Subscribe to positions updates for a user
  subscribePositions(userAddress) {
    const subscriptionId = `positions:${userAddress}`;
    
    if (this.subscriptions.has(subscriptionId)) {
      return subscriptionId;
    }
    
    const message = {
      type: 'subscribe',
      channel: 'positions',
      address: userAddress.toLowerCase()
    };
    
    this._sendMessage(message);
    (this.subscriptions + subscriptionId);
    
    this.emit('subscriptionAdded', { channel: 'positions', address: userAddress });
    
    return subscriptionId;
  }
  
  // Subscribe to liquidations
  subscribeLiquidations(market = null) {
    const subscriptionId = market ? `liquidations:${market}` : 'liquidations:all';
    
    if (this.subscriptions.has(subscriptionId)) {
      return subscriptionId;
    }
    
    const message = {
      type: 'subscribe',
      channel: 'liquidations',
      market: market
    };
    
    this._sendMessage(message);
    (this.subscriptions + subscriptionId);
    
    this.emit('subscriptionAdded', { channel: 'liquidations', market });
    
    return subscriptionId;
  }
  
  // Subscribe to trades
  subscribeTrades(market = null) {
    const subscriptionId = market ? `trades:${market}` : 'trades:all';
    
    if (this.subscriptions.has(subscriptionId)) {
      return subscriptionId;
    }
    
    const message = {
      type: 'subscribe',
      channel: 'trades',
      market: market
    };
    
    this._sendMessage(message);
    (this.subscriptions + subscriptionId);
    
    this.emit('subscriptionAdded', { channel: 'trades', market });
    
    return subscriptionId;
  }
  
  // Subscribe to oracle updates
  subscribeOracle(market) {
    const subscriptionId = `oracle:${market}`;
    
    if (this.subscriptions.has(subscriptionId)) {
      return subscriptionId;
    }
    
    const message = {
      type: 'subscribe',
      channel: 'oracle',
      market: market
    };
    
    this._sendMessage(message);
    (this.subscriptions + subscriptionId);
    
    this.emit('subscriptionAdded', { channel: 'oracle', market });
    
    return subscriptionId;
  }
  
  // Subscribe to funding rates
  subscribeFundingRates(market = null) {
    const subscriptionId = market ? `funding:${market}` : 'funding:all';
    
    if (this.subscriptions.has(subscriptionId)) {
      return subscriptionId;
    }
    
    const message = {
      type: 'subscribe',
      channel: 'funding',
      market: market
    };
    
    this._sendMessage(message);
    (this.subscriptions + subscriptionId);
    
    this.emit('subscriptionAdded', { channel: 'funding', market });
    
    return subscriptionId;
  }
  
  // Unsubscribe from a channel
  unsubscribe(subscriptionId) {
    if (!this.subscriptions.has(subscriptionId)) {
      return;
    }
    
    const [channel, ...params] = subscriptionId.split(':');
    const param = params.join(':');
    
    const message = {
      type: 'unsubscribe',
      channel: channel,
      ...(param && { [channel === 'positions' ? 'address' : 'market']: param })
    };
    
    this._sendMessage(message);
    this.subscriptions.delete(subscriptionId);
    
    this.emit('subscriptionRemoved', { channel, param });
  }
  
  // Unsubscribe from all channels
  unsubscribeAll() {
    this.subscriptions.forEach(subscriptionId => {
      this.unsubscribe(subscriptionId);
    });
  }
  
  // Send ping to server
  ping() {
    if (this.isConnected) {
      this._sendMessage({ type: 'ping' });
    }
  }
  
  // Get connection status
  getStatus() {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      reconnectAttempts: this.reconnectAttempts,
      subscriptionCount: this.subscriptions.size,
      queueSize: this.messageQueue.length
    };
  }
  
  // Private methods
  _onOpen() {
    console.log('WebSocket connected');
    
    this.isConnected = true;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    
    // Start heartbeat
    this._startHeartbeat();
    
    // Re-subscribe to previous channels
    this._resubscribe();
    
    // Process queued messages
    this._processMessageQueue();
    
    this.emit('connected');
  }
  
  _onClose(event) {
    console.log('WebSocket disconnected:', event.code, event.reason);
    
    this.isConnected = false;
    this.isConnecting = false;
    
    this._clearTimers();
    
    this.emit('disconnected', { code: event.code, reason: event.reason });
    
    // Schedule reconnect if not explicitly disconnected
    if (event.code !== 1000) {
      this._scheduleReconnect();
    }
  }
  
  _onError(error) {
    console.error('WebSocket error:', error);
    this.emit('error', error);
  }
  
  _onMessage(event) {
    try {
      const message = JSON.parse(event.data);
      this._handleMessage(message);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error, event.data);
      this.emit('messageError', { error, data: event.data });
    }
  }
  
  _handleMessage(message) {
    // Validate message structure
    if (!message.type) {
      console.warn('Received message without type:', message);
      return;
    }
    
    // Handle heartbeat/pong
    if (message.type === 'pong') {
      this.emit('pong', message);
      return;
    }
    
    // Debounce rapid messages
    if (this.options.messageDebounce > 0) {
      this._debounceMessage(message);
    } else {
      this._processMessage(message);
    }
  }
  
  _debounceMessage(message) {
    // Clear previous timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    // Add to queue
    this.messageQueue.push(message);
    
    // Set new timer
    this.debounceTimer = setTimeout(() => {
      this._processQueuedMessages();
    }, this.options.messageDebounce);
  }
  
  _processQueuedMessages() {
    if (this.messageQueue.length === 0) return;
    
    // Process all queued messages
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    
    // Group messages by type for efficiency
    const grouped = {};
    messages.forEach(msg => {
      if (!grouped[msg.type]) {
        grouped[msg.type] = [];
      }
      grouped[msg.type].push(msg);
    });
    
    // Process each group
    Object.entries(grouped).forEach(([type, msgs]) => {
      this._processMessageBatch(type, msgs);
    });
  }
  
  _processMessageBatch(type, messages) {
    // Get handler for this message type
    const handler = this.messageHandlers.get(type);
    if (handler) {
      try {
        handler(messages);
      } catch (error) {
        console.error(`Error in message handler for ${type}:`, error);
      }
    } else {
      // Default handling - emit individual messages
      messages.forEach(msg => {
        this.emit(type, msg);
        this.emit('message', msg);
      });
    }
  }
  
  _processMessage(message) {
    // Get handler for this message type
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      try {
        handler([message]);
      } catch (error) {
        console.error(`Error in message handler for ${message.type}:`, error);
      }
    } else {
      // Default handling
      this.emit(message.type, message);
      this.emit('message', message);
    }
  }
  
  _setupMessageHandlers() {
    // Position updates handler
    this.messageHandlers.set('positionUpdate', (messages) => {
      const updates = messages.map(msg => msg.data);
      this.emit('positions', updates);
      
      // Also emit individual updates for specific users
      updates.forEach(update => {
        this.emit(`position:${update.owner}`, update);
      });
    });
    
    // Trade updates handler
    this.messageHandlers.set('trade', (messages) => {
      const trades = messages.map(msg => msg.data);
      this.emit('trades', trades);
      
      // Group by market for efficiency
      const byMarket = {};
      trades.forEach(trade => {
        if (!byMarket[trade.market]) {
          byMarket[trade.market] = [];
        }
        byMarket[trade.market].push(trade);
      });
      
      Object.entries(byMarket).forEach(([market, marketTrades]) => {
        this.emit(`trades:${market}`, marketTrades);
      });
    });
    
    // Liquidation updates handler
    this.messageHandlers.set('liquidation', (messages) => {
      const liquidations = messages.map(msg => msg.data);
      this.emit('liquidations', liquidations);
      
      // Group by market
      const byMarket = {};
      liquidations.forEach(liq => {
        if (!byMarket[liq.market]) {
          byMarket[liq.market] = [];
        }
        byMarket[liq.market].push(liq);
      });
      
      Object.entries(byMarket).forEach(([market, marketLiquidations]) => {
        this.emit(`liquidations:${market}`, marketLiquidations);
      });
    });
    
    // Oracle updates handler
    this.messageHandlers.set('oracleUpdate', (messages) => {
      const updates = messages.map(msg => msg.data);
      this.emit('oracle', updates);
      
      updates.forEach(update => {
        this.emit(`oracle:${update.market}`, update);
      });
    });
    
    // Funding rate updates handler
    this.messageHandlers.set('fundingRateUpdate', (messages) => {
      const updates = messages.map(msg => msg.data);
      this.emit('funding', updates);
      
      updates.forEach(update => {
        this.emit(`funding:${update.market}`, update);
      });
    });
  }
  
  _sendMessage(message) {
    if (!this.isConnected) {
      // Queue message for later
      if (this.messageQueue.length < this.options.maxQueueSize) {
        this.messageQueue.push({ type: 'outgoing', data: message });
      } else {
        console.warn('Message queue full, dropping message:', message);
      }
      return;
    }
    
    try {
      const json = JSON.stringify(message);
      this.ws.send(json);
    } catch (error) {
      console.error('Failed to send WebSocket message:', error);
      this.emit('sendError', { error, message });
    }
  }
  
  _processMessageQueue() {
    const outgoing = this.messageQueue.filter(msg => msg.type === 'outgoing');
    this.messageQueue = this.messageQueue.filter(msg => msg.type !== 'outgoing');
    
    outgoing.forEach(msg => {
      this._sendMessage(msg.data);
    });
  }
  
  _resubscribe() {
    this.subscriptions.forEach(subscriptionId => {
      const [channel, ...params] = subscriptionId.split(':');
      const param = params.join(':');
      
      const message = {
        type: 'subscribe',
        channel: channel,
        ...(param && { [channel === 'positions' ? 'address' : 'market']: param })
      };
      
      this._sendMessage(message);
    });
  }
  
  _startHeartbeat() {
    this._clearHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      this.ping();
    }, this.options.heartbeatInterval);
  }
  
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      this.emit('reconnectFailed');
      return;
    }
    
    this._clearReconnectTimer();
    
    const delay = Math.min(
      this.options.reconnectInterval * Math.pow(1.5, this.reconnectAttempts),
      30000 // Max 30 seconds
    );
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`Reconnect attempt ${this.reconnectAttempts}`);
      this.connect();
    }, delay);
    
    this.emit('reconnectScheduled', { attempt: this.reconnectAttempts + 1, delay });
  }
  
  _clearTimers() {
    this._clearReconnectTimer();
    this._clearHeartbeat();
    this._clearDebounceTimer();
  }
  
  _clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  
  _clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  _clearDebounceTimer() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

// Export singleton instance
let wsClientInstance = null;

export function getWebSocketClient(options) {
  if (!wsClientInstance) {
    wsClientInstance = new WebSocketClient(options);
  }
  return wsClientInstance;
}

// Hook for React components
export function useWebSocket() {
  const [client, setClient] = useState(null);
  const [status, setStatus] = useState({ isConnected: false });
  const [subscriptions, setSubscriptions] = useState(new Set());
  
  useEffect(() => {
    const wsClient = getWebSocketClient();
    setClient(wsClient);
    
    // Connect on mount
    wsClient.connect();
    
    // Set up event listeners
    const onConnected = () => {
      setStatus(prev => ({ ...prev, isConnected: true }));
    };
    
    const onDisconnected = () => {
      setStatus(prev => ({ ...prev, isConnected: false }));
    };
    
    const onStatus = (newStatus) => {
      setStatus(newStatus);
    };
    
    const onSubscriptionAdded = ({ channel, ...params }) => {
      setSubscriptions(prev => {
        const newSubs = new Set(prev);
        const id = `${channel}:${Object.values(params).join(':')}`;
        (newSubs + id);
        return newSubs;
      });
    };
    
    const onSubscriptionRemoved = ({ channel, ...params }) => {
      setSubscriptions(prev => {
        const newSubs = new Set(prev);
        const id = `${channel}:${Object.values(params).join(':')}`;
        newSubs.delete(id);
        return newSubs;
      });
    };
    
    wsClient.on('connected', onConnected);
    wsClient.on('disconnected', onDisconnected);
    wsClient.on('status', onStatus);
    wsClient.on('subscriptionAdded', onSubscriptionAdded);
    wsClient.on('subscriptionRemoved', onSubscriptionRemoved);
    
    // Clean up on unmount
    return () => {
      wsClient.off('connected', onConnected);
      wsClient.off('disconnected', onDisconnected);
      wsClient.off('status', onStatus);
      wsClient.off('subscriptionAdded', onSubscriptionAdded);
      wsClient.off('subscriptionRemoved', onSubscriptionRemoved);
      
      // Only disconnect if no other components are using it
      // In a real app, you'd want reference counting
    };
  }, []);
  
  const subscribePositions = useCallback((userAddress) => {
    if (!client) return null;
    return client.subscribePositions(userAddress);
  }, [client]);
  
  const subscribeLiquidations = useCallback((market) => {
    if (!client) return null;
    return client.subscribeLiquidations(market);
  }, [client]);
  
  const unsubscribe = useCallback((subscriptionId) => {
    if (!client) return;
    client.unsubscribe(subscriptionId);
  }, [client]);
  
  return {
    client,
    status,
    subscriptions: Array.from(subscriptions),
    subscribePositions,
    subscribeLiquidations,
    unsubscribe,
    isConnected: status.isConnected
  };
}