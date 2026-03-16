// @title: Hook Principal Web3 avec Fallback & Security Guards
// @security: Network validation, provider fallback, read-only mode
// @features: Auto-reconnect, error handling, gas optimization

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { CONTRACT_ADDRESSES, ABI } from '../utils/contracts';

// Configuration
const SUPPORTED_NETWORKS = {
  42161: 'Arbitrum Mainnet',
  421613: 'Arbitrum Goerli',
  8453: 'Base Mainnet',
  84531: 'Base Goerli',
  10: 'Optimism Mainnet',
  420: 'Optimism Goerli'
};

const DEFAULT_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '42161');

// Fallback RPC URLs
const RPC_URLS = {
  42161: process.env.NEXT_PUBLIC_ARBITRUM_RPC || 'https://arb1.arbitrum.io/rpc',
  421613: process.env.NEXT_PUBLIC_ARBITRUM_TESTNET_RPC || 'https://goerli-rollup.arbitrum.io/rpc',
  8453: process.env.NEXT_PUBLIC_BASE_RPC || 'https://mainnet.base.org',
  84531: process.env.NEXT_PUBLIC_BASE_TESTNET_RPC || 'https://goerli.base.org',
  10: process.env.NEXT_PUBLIC_OPTIMISM_RPC || 'https://mainnet.optimism.io',
  420: process.env.NEXT_PUBLIC_OPTIMISM_TESTNET_RPC || 'https://goerli.optimism.io'
};

export const usePerpDex = () => {
  // State
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);
  const [signer, setSigner] = useState(null);
  const [provider, setProvider] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [error, setError] = useState(null);
  
  // Initialize provider (with fallback)
  const initProvider = useCallback(() => {
    try {
      // Try to use window.ethereum first
      if (window.ethereum) {
        const web3Provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
        return web3Provider;
      }
      
      // Fallback to public RPC
      console.warn('No web3 provider found, using public RPC (read-only mode)');
      setIsReadOnly(true);
      
      const rpcUrl = RPC_URLS[DEFAULT_CHAIN_ID];
      if (!rpcUrl) {
        throw new Error(`No RPC URL configured for chain ${DEFAULT_CHAIN_ID}`);
      }
      
      return new ethers.providers.JsonRpcProvider(rpcUrl);
      
    } catch (err) {
      console.error('Failed to initialize provider:', err);
      setError('Failed to connect to blockchain');
      return null;
    }
  }, []);
  
  // Connect wallet
  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      toast.error('Please install MetaMask or another Web3 wallet');
      return;
    }
    
    setIsConnecting(true);
    setError(null);
    
    try {
      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });
      
      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }
      
      const web3Provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      
      // Get network
      const network = await web3Provider.getNetwork();
      
      // Validate network
      if (!SUPPORTED_NETWORKS[network.chainId]) {
        toast.warning(`Unsupported network. Please switch to ${SUPPORTED_NETWORKS[DEFAULT_CHAIN_ID]}`);
        
        // Try to switch network
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${DEFAULT_CHAIN_ID.toString(16)}` }],
          });
        } catch (switchError) {
          // If network doesn't exist in wallet, add it
          if (switchError.code === 4902) {
            const networkParams = getNetworkParams(DEFAULT_CHAIN_ID);
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [networkParams],
            });
          }
        }
      }
      
      // Update state
      setAccount(accounts[0]);
      setChainId(network.chainId);
      setSigner(web3Provider.getSigner());
      setProvider(web3Provider);
      setIsReadOnly(false);
      
      toast.success('Wallet connected successfully');
      
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      
      let errorMessage = 'Failed to connect wallet';
      if (err.code === 4001) {
        errorMessage = 'Connection rejected by user';
      } else if (err.message.includes('already pending')) {
        errorMessage = 'Connection request already pending';
      }
      
      setError(errorMessage);
      toast.error(errorMessage);
      
      // Fallback to read-only mode
      const fallbackProvider = initProvider();
      if (fallbackProvider) {
        setProvider(fallbackProvider);
        setIsReadOnly(true);
      }
      
    } finally {
      setIsConnecting(false);
    }
  }, [initProvider]);
  
  // Switch network
  const switchNetwork = useCallback(async (targetChainId) => {
    if (!window.ethereum) {
      toast.error('Please install MetaMask to switch networks');
      return;
    }
    
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      });
      
      toast.success(`Switched to ${SUPPORTED_NETWORKS[targetChainId]}`);
      
    } catch (switchError) {
      // If network doesn't exist in wallet, add it
      if (switchError.code === 4902) {
        try {
          const networkParams = getNetworkParams(targetChainId);
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [networkParams],
          });
        } catch (addError) {
          console.error('Failed to add network:', addError);
          toast.error('Failed to add network to wallet');
        }
      } else {
        console.error('Failed to switch network:', switchError);
        toast.error('Failed to switch network');
      }
    }
  }, []);
  
  // Disconnect wallet
  const disconnectWallet = useCallback(() => {
    setAccount(null);
    setSigner(null);
    setIsReadOnly(true);
    toast.info('Wallet disconnected');
  }, []);
  
  // Listen for account changes
  useEffect(() => {
    if (!window.ethereum) return;
    
    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        // User disconnected all accounts
        disconnectWallet();
      } else if (accounts[0] !== account) {
        setAccount(accounts[0]);
        toast.info('Account changed');
      }
    };
    
    const handleChainChanged = (chainIdHex) => {
      const newChainId = parseInt(chainIdHex, 16);
      setChainId(newChainId);
      
      if (!SUPPORTED_NETWORKS[newChainId]) {
        toast.warning(`Unsupported network: ${newChainId}`);
      } else {
        toast.info(`Network changed to ${SUPPORTED_NETWORKS[newChainId]}`);
      }
    };
    
    const handleDisconnect = () => {
      disconnectWallet();
      toast.warning('Wallet disconnected');
    };
    
    // Add event listeners
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    window.ethereum.on('disconnect', handleDisconnect);
    
    // Cleanup
    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
        window.ethereum.removeListener('disconnect', handleDisconnect);
      }
    };
  }, [account, disconnectWallet]);
  
  // Auto-connect on mount (if previously connected)
  useEffect(() => {
    const checkConnection = async () => {
      if (window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts.length > 0) {
            // Reconnect
            const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
            const network = await web3Provider.getNetwork();
            
            setAccount(accounts[0]);
            setChainId(network.chainId);
            setSigner(web3Provider.getSigner());
            setProvider(web3Provider);
            setIsReadOnly(false);
            
            console.log('Auto-connected to wallet');
          } else {
            // No accounts, use read-only mode
            const fallbackProvider = initProvider();
            if (fallbackProvider) {
              setProvider(fallbackProvider);
              setIsReadOnly(true);
            }
          }
        } catch (err) {
          console.error('Auto-connect failed:', err);
          // Fallback to read-only
          const fallbackProvider = initProvider();
          if (fallbackProvider) {
            setProvider(fallbackProvider);
            setIsReadOnly(true);
          }
        }
      } else {
        // No wallet, use read-only mode
        const fallbackProvider = initProvider();
        if (fallbackProvider) {
          setProvider(fallbackProvider);
          setIsReadOnly(true);
        }
      }
    };
    
    checkConnection();
  }, [initProvider]);
  
  // Contract instances
  const contracts = useMemo(() => {
    if (!provider || !chainId) return {};
    
    const address = CONTRACT_ADDRESSES[chainId];
    if (!address) return {};
    
    return {
      perpEngine: new ethers.Contract(address.PerpEngine, ABI.PerpEngine, 
        isReadOnly ? provider : signer),
      positionManager: new ethers.Contract(address.PositionManager, ABI.PositionManager, 
        isReadOnly ? provider : signer),
      ammPool: new ethers.Contract(address.AMMPool, ABI.AMMPool, 
        isReadOnly ? provider : signer),
      oracleAggregator: new ethers.Contract(address.OracleAggregator, ABI.OracleAggregator, 
        isReadOnly ? provider : signer),
    };
  }, [provider, chainId, signer, isReadOnly]);
  
  // Check if on correct network
  const isCorrectNetwork = useMemo(() => {
    return chainId === DEFAULT_CHAIN_ID;
  }, [chainId]);
  
  return {
    // State
    account,
    chainId,
    signer,
    provider,
    isConnecting,
    isReadOnly,
    error,
    isCorrectNetwork,
    
    // Contracts
    contracts,
    
    // Methods
    connectWallet,
    disconnectWallet,
    switchNetwork,
    
    // Network info
    networkName: SUPPORTED_NETWORKS[chainId] || 'Unknown',
    supportedNetworks: SUPPORTED_NETWORKS,
    
    // Utility
    formatAddress: (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '',
  };
};

// Helper: Get network parameters for wallet_addEthereumChain
const getNetworkParams = (chainId) => {
  const networks = {
    42161: {
      chainId: '0xA4B1',
      chainName: 'Arbitrum One',
      nativeCurrency: {
        name: 'Ethereum',
        symbol: 'ETH',
        decimals: 18
      },
      rpcUrls: ['https://arb1.arbitrum.io/rpc'],
      blockExplorerUrls: ['https://arbiscan.io/']
    },
    421613: {
      chainId: '0x66EED',
      chainName: 'Arbitrum Goerli',
      nativeCurrency: {
        name: 'Ethereum',
        symbol: 'ETH',
        decimals: 18
      },
      rpcUrls: ['https://goerli-rollup.arbitrum.io/rpc'],
      blockExplorerUrls: ['https://goerli.arbiscan.io/']
    },
    8453: {
      chainId: '0x2105',
      chainName: 'Base',
      nativeCurrency: {
        name: 'Ethereum',
        symbol: 'ETH',
        decimals: 18
      },
      rpcUrls: ['https://mainnet.base.org'],
      blockExplorerUrls: ['https://basescan.org/']
    },
    10: {
      chainId: '0xA',
      chainName: 'Optimism',
      nativeCurrency: {
        name: 'Ethereum',
        symbol: 'ETH',
        decimals: 18
      },
      rpcUrls: ['https://mainnet.optimism.io'],
      blockExplorerUrls: ['https://optimistic.etherscan.io/']
    }
  };
  
  return networks[chainId] || null;
};