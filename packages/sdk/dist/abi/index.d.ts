export declare const ABIs: {
    PerpEngine: {
        abi: ({
            type: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            stateMutability: string;
            name?: undefined;
            outputs?: undefined;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            outputs: ({
                name: string;
                type: string;
                internalType: string;
                components: {
                    name: string;
                    type: string;
                    internalType: string;
                }[];
            } | {
                name: string;
                type: string;
                internalType: string;
                components?: undefined;
            })[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
                components: {
                    name: string;
                    type: string;
                    internalType: string;
                }[];
            }[];
            outputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                indexed: boolean;
                internalType: string;
            }[];
            anonymous: boolean;
            stateMutability?: undefined;
            outputs?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            stateMutability?: undefined;
            outputs?: undefined;
            anonymous?: undefined;
        })[];
        bytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        deployedBytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
            immutableReferences: {
                "2383": {
                    start: number;
                    length: number;
                }[];
                "2385": {
                    start: number;
                    length: number;
                }[];
                "2387": {
                    start: number;
                    length: number;
                }[];
                "2389": {
                    start: number;
                    length: number;
                }[];
                "2391": {
                    start: number;
                    length: number;
                }[];
                "2393": {
                    start: number;
                    length: number;
                }[];
                "2395": {
                    start: number;
                    length: number;
                }[];
                "2398": {
                    start: number;
                    length: number;
                }[];
                "2401": {
                    start: number;
                    length: number;
                }[];
            };
        };
        methodIdentifiers: {
            "accrueFunding(uint256)": string;
            "addMargin(uint256,uint256)": string;
            "ammPool()": string;
            "baseToken()": string;
            "batchAccrueFunding(uint256[])": string;
            "batchGetHealthFactors(uint256[])": string;
            "batchGetPositions(uint256[])": string;
            "batchIsLiquidatable(uint256[],uint256[])": string;
            "closePosition(uint256)": string;
            "configRegistry()": string;
            "decreasePosition(uint256,uint256,uint256)": string;
            "getAvailableMargin(uint256)": string;
            "getFundingState(uint256)": string;
            "getHealthFactor(uint256)": string;
            "getLiquidationPrice(uint256)": string;
            "getMarket(uint256)": string;
            "getMarketStats(uint256)": string;
            "getMaxAdditionalSize(uint256,uint256)": string;
            "getPosition(uint256)": string;
            "getPositionInternal(uint256)": string;
            "getPositionStats()": string;
            "getPositionsByMarket(uint256,uint256,uint256)": string;
            "getPositionsByTrader(address,uint256,uint256)": string;
            "getProtocolFees(address)": string;
            "getTotalOpenInterest(uint256)": string;
            "getTraderPositions(address)": string;
            "getUnrealizedPnl(uint256,uint256)": string;
            "governance()": string;
            "increasePosition(uint256,uint256,uint256)": string;
            "initializeMarket(uint256,bytes32,uint256,uint256,uint256,uint256,uint256)": string;
            "insuranceFund()": string;
            "isPositionLiquidatable(uint256,uint256)": string;
            "liquidatePosition((uint256,address,uint256,uint256,uint256))": string;
            "liquidationEngine()": string;
            "openPosition((uint256,bool,uint256,uint256,uint256,uint256,bytes32))": string;
            "oracleAggregator()": string;
            "paused()": string;
            "positionManager()": string;
            "previewLiquidation(uint256,uint256)": string;
            "quoteToken()": string;
            "removeMargin(uint256,uint256)": string;
            "riskManager()": string;
            "setGovernance(address)": string;
            "totalCollateral()": string;
            "totalFeesAccrued()": string;
            "totalFundingPaid()": string;
            "totalFundingReceived()": string;
            "totalPositionValue()": string;
            "updateFundingParams(uint256,uint256)": string;
            "updateLiquidationPenalty(uint256)": string;
            "updateProtocolFee(uint256)": string;
        };
        rawMetadata: string;
        metadata: {
            compiler: {
                version: string;
            };
            language: string;
            output: {
                abi: ({
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name?: undefined;
                    anonymous?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    type: string;
                    name: string;
                    stateMutability?: undefined;
                    anonymous?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        indexed: boolean;
                    }[];
                    type: string;
                    name: string;
                    anonymous: boolean;
                    stateMutability?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    anonymous?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: ({
                        internalType: string;
                        name: string;
                        type: string;
                        components: {
                            internalType: string;
                            name: string;
                            type: string;
                        }[];
                    } | {
                        internalType: string;
                        name: string;
                        type: string;
                        components?: undefined;
                    })[];
                    anonymous?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        components: {
                            internalType: string;
                            name: string;
                            type: string;
                        }[];
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    anonymous?: undefined;
                })[];
                devdoc: {
                    kind: string;
                    methods: {
                        "accrueFunding(uint256)": {
                            params: {
                                marketId: string;
                            };
                        };
                        "addMargin(uint256,uint256)": {
                            params: {
                                amount: string;
                                positionId: string;
                            };
                        };
                        "batchAccrueFunding(uint256[])": {
                            params: {
                                marketIds: string;
                            };
                        };
                        "batchGetHealthFactors(uint256[])": {
                            params: {
                                positionIds: string;
                            };
                            returns: {
                                healthFactors: string;
                            };
                        };
                        "batchGetPositions(uint256[])": {
                            params: {
                                positionIds: string;
                            };
                            returns: {
                                views: string;
                            };
                        };
                        "batchIsLiquidatable(uint256[],uint256[])": {
                            params: {
                                currentPrices: string;
                                positionIds: string;
                            };
                            returns: {
                                liquidatable: string;
                            };
                        };
                        "closePosition(uint256)": {
                            params: {
                                positionId: string;
                            };
                        };
                        "decreasePosition(uint256,uint256,uint256)": {
                            params: {
                                marginReduced: string;
                                positionId: string;
                                sizeReduced: string;
                            };
                        };
                        "getAvailableMargin(uint256)": {
                            params: {
                                positionId: string;
                            };
                            returns: {
                                availableMargin: string;
                            };
                        };
                        "getHealthFactor(uint256)": {
                            params: {
                                positionId: string;
                            };
                            returns: {
                                healthFactor: string;
                            };
                        };
                        "getLiquidationPrice(uint256)": {
                            params: {
                                positionId: string;
                            };
                            returns: {
                                liquidationPrice: string;
                            };
                        };
                        "getMarketStats(uint256)": {
                            params: {
                                marketId: string;
                            };
                            returns: {
                                stats: string;
                            };
                        };
                        "getMaxAdditionalSize(uint256,uint256)": {
                            params: {
                                additionalMargin: string;
                                positionId: string;
                            };
                            returns: {
                                maxAdditionalSize: string;
                            };
                        };
                        "getPosition(uint256)": {
                            params: {
                                positionId: string;
                            };
                            returns: {
                                viewData: string;
                            };
                        };
                        "getPositionInternal(uint256)": {
                            params: {
                                positionId: string;
                            };
                            returns: {
                                _0: string;
                            };
                        };
                        "getPositionStats()": {
                            returns: {
                                stats: string;
                            };
                        };
                        "getPositionsByMarket(uint256,uint256,uint256)": {
                            params: {
                                cursor: string;
                                limit: string;
                                marketId: string;
                            };
                            returns: {
                                newCursor: string;
                                positions: string;
                            };
                        };
                        "getPositionsByTrader(address,uint256,uint256)": {
                            params: {
                                cursor: string;
                                limit: string;
                                trader: string;
                            };
                            returns: {
                                newCursor: string;
                                positions: string;
                            };
                        };
                        "getUnrealizedPnl(uint256,uint256)": {
                            params: {
                                currentPrice: string;
                                positionId: string;
                            };
                            returns: {
                                pnl: string;
                            };
                        };
                        "increasePosition(uint256,uint256,uint256)": {
                            params: {
                                marginAdded: string;
                                positionId: string;
                                sizeAdded: string;
                            };
                        };
                        "initializeMarket(uint256,bytes32,uint256,uint256,uint256,uint256,uint256)": {
                            params: {
                                liquidationFeeRatio: string;
                                marketId: string;
                                maxLeverage: string;
                                minMarginRatio: string;
                                oracleFeedId: string;
                                protocolFeeRatio: string;
                            };
                        };
                        "isPositionLiquidatable(uint256,uint256)": {
                            params: {
                                currentPrice: string;
                                positionId: string;
                            };
                            returns: {
                                liquidatable: string;
                            };
                        };
                        "liquidatePosition((uint256,address,uint256,uint256,uint256))": {
                            params: {
                                params: string;
                            };
                            returns: {
                                liquidationReward: string;
                            };
                        };
                        "openPosition((uint256,bool,uint256,uint256,uint256,uint256,bytes32))": {
                            params: {
                                params: string;
                            };
                            returns: {
                                positionId: string;
                            };
                        };
                        "paused()": {
                            details: string;
                        };
                        "previewLiquidation(uint256,uint256)": {
                            params: {
                                currentPrice: string;
                                positionId: string;
                            };
                            returns: {
                                newHealthFactor: string;
                                penalty: string;
                                reward: string;
                            };
                        };
                        "removeMargin(uint256,uint256)": {
                            params: {
                                amount: string;
                                positionId: string;
                            };
                        };
                        "setGovernance(address)": {
                            params: {
                                newGovernance: string;
                            };
                        };
                        "updateFundingParams(uint256,uint256)": {
                            params: {
                                newFundingInterval: string;
                                newMaxFundingRate: string;
                            };
                        };
                        "updateLiquidationPenalty(uint256)": {
                            params: {
                                newLiquidationPenalty: string;
                            };
                        };
                        "updateProtocolFee(uint256)": {
                            params: {
                                newProtocolFee: string;
                            };
                        };
                    };
                    version: number;
                };
                userdoc: {
                    kind: string;
                    methods: {
                        "accrueFunding(uint256)": {
                            notice: string;
                        };
                        "addMargin(uint256,uint256)": {
                            notice: string;
                        };
                        "batchAccrueFunding(uint256[])": {
                            notice: string;
                        };
                        "batchGetHealthFactors(uint256[])": {
                            notice: string;
                        };
                        "batchGetPositions(uint256[])": {
                            notice: string;
                        };
                        "batchIsLiquidatable(uint256[],uint256[])": {
                            notice: string;
                        };
                        "closePosition(uint256)": {
                            notice: string;
                        };
                        "decreasePosition(uint256,uint256,uint256)": {
                            notice: string;
                        };
                        "getAvailableMargin(uint256)": {
                            notice: string;
                        };
                        "getFundingState(uint256)": {
                            notice: string;
                        };
                        "getHealthFactor(uint256)": {
                            notice: string;
                        };
                        "getLiquidationPrice(uint256)": {
                            notice: string;
                        };
                        "getMarket(uint256)": {
                            notice: string;
                        };
                        "getMarketStats(uint256)": {
                            notice: string;
                        };
                        "getMaxAdditionalSize(uint256,uint256)": {
                            notice: string;
                        };
                        "getPosition(uint256)": {
                            notice: string;
                        };
                        "getPositionInternal(uint256)": {
                            notice: string;
                        };
                        "getPositionStats()": {
                            notice: string;
                        };
                        "getPositionsByMarket(uint256,uint256,uint256)": {
                            notice: string;
                        };
                        "getPositionsByTrader(address,uint256,uint256)": {
                            notice: string;
                        };
                        "getProtocolFees(address)": {
                            notice: string;
                        };
                        "getTotalOpenInterest(uint256)": {
                            notice: string;
                        };
                        "getTraderPositions(address)": {
                            notice: string;
                        };
                        "getUnrealizedPnl(uint256,uint256)": {
                            notice: string;
                        };
                        "increasePosition(uint256,uint256,uint256)": {
                            notice: string;
                        };
                        "initializeMarket(uint256,bytes32,uint256,uint256,uint256,uint256,uint256)": {
                            notice: string;
                        };
                        "isPositionLiquidatable(uint256,uint256)": {
                            notice: string;
                        };
                        "liquidatePosition((uint256,address,uint256,uint256,uint256))": {
                            notice: string;
                        };
                        "openPosition((uint256,bool,uint256,uint256,uint256,uint256,bytes32))": {
                            notice: string;
                        };
                        "previewLiquidation(uint256,uint256)": {
                            notice: string;
                        };
                        "removeMargin(uint256,uint256)": {
                            notice: string;
                        };
                        "setGovernance(address)": {
                            notice: string;
                        };
                        "updateFundingParams(uint256,uint256)": {
                            notice: string;
                        };
                        "updateLiquidationPenalty(uint256)": {
                            notice: string;
                        };
                        "updateProtocolFee(uint256)": {
                            notice: string;
                        };
                    };
                    version: number;
                };
            };
            settings: {
                remappings: string[];
                optimizer: {
                    enabled: boolean;
                    runs: number;
                };
                metadata: {
                    bytecodeHash: string;
                };
                compilationTarget: {
                    "contracts/core/PerpEngine.sol": string;
                };
                evmVersion: string;
                libraries: {};
            };
            sources: {
                "contracts/core/PerpEngine.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IAMMPool.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IConfigRegistry.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/ILiquidationEngine.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IOracleAggregator.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IPerpEngine.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IPositionManager.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IPositionViewer.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IRiskManager.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/libraries/FundingRateCalculator.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/libraries/PositionMath.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/libraries/SafeDecimalMath.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/security/Pausable.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/security/ReentrancyGuard.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/utils/Address.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/utils/Context.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/utils/math/Math.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
            };
            version: number;
        };
        id: number;
    };
    AMMPool: {
        abi: ({
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            outputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                indexed: boolean;
                internalType: string;
            }[];
            anonymous: boolean;
            outputs?: undefined;
            stateMutability?: undefined;
        })[];
        bytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        deployedBytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        methodIdentifiers: {
            "applyFunding(uint256,uint256,bool,uint256)": string;
            "calculateFundingPayment(uint256,uint256,bool,uint256)": string;
            "emergencyResetSkew(uint256)": string;
            "getFundingRate(uint256)": string;
            "getMarkPrice(uint256,uint256)": string;
            "getMarketSkew(uint256)": string;
            "getTWAFundingRate(uint256,uint256)": string;
            "updateFundingRate(uint256)": string;
            "updateMaxFundingRate(uint256,uint256)": string;
            "updateSkew(uint256,bool,int256)": string;
            "updateSkewScale(uint256,uint256)": string;
        };
        rawMetadata: string;
        metadata: {
            compiler: {
                version: string;
            };
            language: string;
            output: {
                abi: ({
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        indexed: boolean;
                    }[];
                    type: string;
                    name: string;
                    anonymous: boolean;
                    stateMutability?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    anonymous?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    anonymous?: undefined;
                    outputs?: undefined;
                })[];
                devdoc: {
                    kind: string;
                    methods: {
                        "applyFunding(uint256,uint256,bool,uint256)": {
                            params: {
                                isLong: string;
                                lastFundingAccrued: string;
                                marketId: string;
                                positionSize: string;
                            };
                            returns: {
                                fundingPayment: string;
                            };
                        };
                        "calculateFundingPayment(uint256,uint256,bool,uint256)": {
                            params: {
                                isLong: string;
                                lastFundingAccrued: string;
                                marketId: string;
                                positionSize: string;
                            };
                            returns: {
                                fundingPayment: string;
                            };
                        };
                        "emergencyResetSkew(uint256)": {
                            details: string;
                            params: {
                                marketId: string;
                            };
                        };
                        "getFundingRate(uint256)": {
                            params: {
                                marketId: string;
                            };
                            returns: {
                                fundingRate: string;
                            };
                        };
                        "getMarkPrice(uint256,uint256)": {
                            params: {
                                indexPrice: string;
                                marketId: string;
                            };
                            returns: {
                                markPrice: string;
                            };
                        };
                        "getMarketSkew(uint256)": {
                            params: {
                                marketId: string;
                            };
                            returns: {
                                longOI: string;
                                netSkew: string;
                                shortOI: string;
                            };
                        };
                        "getTWAFundingRate(uint256,uint256)": {
                            params: {
                                marketId: string;
                                period: string;
                            };
                            returns: {
                                avgFundingRate: string;
                            };
                        };
                        "updateFundingRate(uint256)": {
                            params: {
                                marketId: string;
                            };
                            returns: {
                                fundingRate: string;
                            };
                        };
                        "updateMaxFundingRate(uint256,uint256)": {
                            params: {
                                marketId: string;
                                newMaxFundingRate: string;
                            };
                        };
                        "updateSkew(uint256,bool,int256)": {
                            params: {
                                isLong: string;
                                marketId: string;
                                sizeChange: string;
                            };
                        };
                        "updateSkewScale(uint256,uint256)": {
                            params: {
                                marketId: string;
                                newSkewScale: string;
                            };
                        };
                    };
                    version: number;
                };
                userdoc: {
                    kind: string;
                    methods: {
                        "applyFunding(uint256,uint256,bool,uint256)": {
                            notice: string;
                        };
                        "calculateFundingPayment(uint256,uint256,bool,uint256)": {
                            notice: string;
                        };
                        "emergencyResetSkew(uint256)": {
                            notice: string;
                        };
                        "getFundingRate(uint256)": {
                            notice: string;
                        };
                        "getMarkPrice(uint256,uint256)": {
                            notice: string;
                        };
                        "getMarketSkew(uint256)": {
                            notice: string;
                        };
                        "getTWAFundingRate(uint256,uint256)": {
                            notice: string;
                        };
                        "updateFundingRate(uint256)": {
                            notice: string;
                        };
                        "updateMaxFundingRate(uint256,uint256)": {
                            notice: string;
                        };
                        "updateSkew(uint256,bool,int256)": {
                            notice: string;
                        };
                        "updateSkewScale(uint256,uint256)": {
                            notice: string;
                        };
                    };
                    version: number;
                };
            };
            settings: {
                remappings: string[];
                optimizer: {
                    enabled: boolean;
                    runs: number;
                };
                metadata: {
                    bytecodeHash: string;
                };
                compilationTarget: {
                    "contracts/interfaces/IAMMPool.sol": string;
                };
                evmVersion: string;
                libraries: {};
            };
            sources: {
                "contracts/interfaces/IAMMPool.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
            };
            version: number;
        };
        id: number;
    };
    LiquidationEngine: {
        abi: ({
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            outputs: ({
                name: string;
                type: string;
                internalType: string;
                components: {
                    name: string;
                    type: string;
                    internalType: string;
                }[];
            } | {
                name: string;
                type: string;
                internalType: string;
                components?: undefined;
            })[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
                components: {
                    name: string;
                    type: string;
                    internalType: string;
                }[];
            }[];
            outputs: never[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                indexed: boolean;
                internalType: string;
            }[];
            anonymous: boolean;
            outputs?: undefined;
            stateMutability?: undefined;
        })[];
        bytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        deployedBytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        methodIdentifiers: {
            "emergencyCancelLiquidation(uint256)": string;
            "estimateReward(uint256,uint256,uint256)": string;
            "executeBatchLiquidation(uint256[],uint256[])": string;
            "executeLiquidation(uint256,uint256)": string;
            "flashLiquidate(uint256,uint256,uint256)": string;
            "getLiquidationQueue(uint256,uint256)": string;
            "getLiquidatorConfig()": string;
            "getQueueLength()": string;
            "isInQueue(uint256)": string;
            "previewLiquidation(uint256,uint256)": string;
            "processQueue(uint256)": string;
            "queueLiquidation(uint256,uint256)": string;
            "setIncentiveMultiplier(uint256)": string;
            "updateLiquidatorConfig((uint256,uint256,uint256,uint256,uint256))": string;
        };
        rawMetadata: string;
        metadata: {
            compiler: {
                version: string;
            };
            language: string;
            output: {
                abi: ({
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        indexed: boolean;
                    }[];
                    type: string;
                    name: string;
                    anonymous: boolean;
                    stateMutability?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    anonymous?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: ({
                        internalType: string;
                        name: string;
                        type: string;
                        components: {
                            internalType: string;
                            name: string;
                            type: string;
                        }[];
                    } | {
                        internalType: string;
                        name: string;
                        type: string;
                        components?: undefined;
                    })[];
                    anonymous?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        components: {
                            internalType: string;
                            name: string;
                            type: string;
                        }[];
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    anonymous?: undefined;
                    outputs?: undefined;
                })[];
                devdoc: {
                    kind: string;
                    methods: {
                        "emergencyCancelLiquidation(uint256)": {
                            details: string;
                            params: {
                                positionId: string;
                            };
                        };
                        "estimateReward(uint256,uint256,uint256)": {
                            params: {
                                liquidatedSize: string;
                                liquidationPrice: string;
                                positionId: string;
                            };
                            returns: {
                                reward: string;
                            };
                        };
                        "executeBatchLiquidation(uint256[],uint256[])": {
                            params: {
                                minRewards: string;
                                positionIds: string;
                            };
                            returns: {
                                results: string;
                            };
                        };
                        "executeLiquidation(uint256,uint256)": {
                            params: {
                                minReward: string;
                                positionId: string;
                            };
                            returns: {
                                result: string;
                            };
                        };
                        "flashLiquidate(uint256,uint256,uint256)": {
                            params: {
                                loanAmount: string;
                                minReward: string;
                                positionId: string;
                            };
                        };
                        "getLiquidationQueue(uint256,uint256)": {
                            params: {
                                cursor: string;
                                limit: string;
                            };
                            returns: {
                                candidates: string;
                                newCursor: string;
                            };
                        };
                        "getLiquidatorConfig()": {
                            returns: {
                                config: string;
                            };
                        };
                        "getQueueLength()": {
                            returns: {
                                queueLength: string;
                            };
                        };
                        "isInQueue(uint256)": {
                            params: {
                                positionId: string;
                            };
                            returns: {
                                inQueue: string;
                            };
                        };
                        "previewLiquidation(uint256,uint256)": {
                            params: {
                                currentPrice: string;
                                positionId: string;
                            };
                            returns: {
                                newHealthFactor: string;
                                penalty: string;
                                reward: string;
                            };
                        };
                        "processQueue(uint256)": {
                            params: {
                                maxProcess: string;
                            };
                            returns: {
                                numProcessed: string;
                            };
                        };
                        "queueLiquidation(uint256,uint256)": {
                            params: {
                                healthFactor: string;
                                positionId: string;
                            };
                        };
                        "setIncentiveMultiplier(uint256)": {
                            params: {
                                newMultiplier: string;
                            };
                        };
                        "updateLiquidatorConfig((uint256,uint256,uint256,uint256,uint256))": {
                            params: {
                                newConfig: string;
                            };
                        };
                    };
                    version: number;
                };
                userdoc: {
                    kind: string;
                    methods: {
                        "emergencyCancelLiquidation(uint256)": {
                            notice: string;
                        };
                        "estimateReward(uint256,uint256,uint256)": {
                            notice: string;
                        };
                        "executeBatchLiquidation(uint256[],uint256[])": {
                            notice: string;
                        };
                        "executeLiquidation(uint256,uint256)": {
                            notice: string;
                        };
                        "flashLiquidate(uint256,uint256,uint256)": {
                            notice: string;
                        };
                        "getLiquidationQueue(uint256,uint256)": {
                            notice: string;
                        };
                        "getLiquidatorConfig()": {
                            notice: string;
                        };
                        "getQueueLength()": {
                            notice: string;
                        };
                        "isInQueue(uint256)": {
                            notice: string;
                        };
                        "previewLiquidation(uint256,uint256)": {
                            notice: string;
                        };
                        "processQueue(uint256)": {
                            notice: string;
                        };
                        "queueLiquidation(uint256,uint256)": {
                            notice: string;
                        };
                        "setIncentiveMultiplier(uint256)": {
                            notice: string;
                        };
                        "updateLiquidatorConfig((uint256,uint256,uint256,uint256,uint256))": {
                            notice: string;
                        };
                    };
                    version: number;
                };
            };
            settings: {
                remappings: string[];
                optimizer: {
                    enabled: boolean;
                    runs: number;
                };
                metadata: {
                    bytecodeHash: string;
                };
                compilationTarget: {
                    "contracts/interfaces/ILiquidationEngine.sol": string;
                };
                evmVersion: string;
                libraries: {};
            };
            sources: {
                "contracts/interfaces/ILiquidationEngine.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
            };
            version: number;
        };
        id: number;
    };
    PositionManager: {
        abi: ({
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            outputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                indexed: boolean;
                internalType: string;
            }[];
            anonymous: boolean;
            outputs?: undefined;
            stateMutability?: undefined;
        })[];
        bytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        deployedBytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        methodIdentifiers: {
            "burn(uint256)": string;
            "getCustomData(uint256)": string;
            "getPositionCount()": string;
            "getPositionMetadata(uint256)": string;
            "getPositionOwner(uint256)": string;
            "getPositionStatus(uint256)": string;
            "getPositionsByOwner(address)": string;
            "mint(address,uint256)": string;
            "setCustomData(uint256,bytes)": string;
            "setMetadata(uint256,bytes32)": string;
        };
        rawMetadata: string;
        metadata: {
            compiler: {
                version: string;
            };
            language: string;
            output: {
                abi: ({
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        indexed: boolean;
                    }[];
                    type: string;
                    name: string;
                    anonymous: boolean;
                    stateMutability?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    anonymous?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    anonymous?: undefined;
                })[];
                devdoc: {
                    kind: string;
                    methods: {};
                    version: number;
                };
                userdoc: {
                    kind: string;
                    methods: {};
                    version: number;
                };
            };
            settings: {
                remappings: string[];
                optimizer: {
                    enabled: boolean;
                    runs: number;
                };
                metadata: {
                    bytecodeHash: string;
                };
                compilationTarget: {
                    "contracts/interfaces/IPositionManager.sol": string;
                };
                evmVersion: string;
                libraries: {};
            };
            sources: {
                "contracts/interfaces/IPositionManager.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
            };
            version: number;
        };
        id: number;
    };
    OracleAggregator: {
        abi: ({
            type: string;
            name: string;
            inputs: ({
                name: string;
                type: string;
                internalType: string;
                components?: undefined;
            } | {
                name: string;
                type: string;
                internalType: string;
                components: {
                    name: string;
                    type: string;
                    internalType: string;
                }[];
            })[];
            outputs: never[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            outputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            outputs: {
                name: string;
                type: string;
                internalType: string;
                components: {
                    name: string;
                    type: string;
                    internalType: string;
                }[];
            }[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                indexed: boolean;
                internalType: string;
            }[];
            anonymous: boolean;
            outputs?: undefined;
            stateMutability?: undefined;
        })[];
        bytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        deployedBytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        methodIdentifiers: {
            "addOracleSource(bytes32,(address,uint8,uint256,uint256,bool,uint256,uint256))": string;
            "emergencyPriceOverride(bytes32,uint256)": string;
            "getConfidence(bytes32)": string;
            "getConsensusPrice(bytes32)": string;
            "getLastUpdate(bytes32)": string;
            "getOracleSources(bytes32)": string;
            "getPrice(bytes32)": string;
            "getPriceData(bytes32)": string;
            "getTWAP(bytes32,uint256)": string;
            "isPriceStale(bytes32)": string;
            "isPriceWithinBounds(bytes32,uint256,uint256)": string;
            "removeOracleSource(bytes32)": string;
            "updatePrice(bytes32,uint256,uint256,uint256)": string;
            "validatePriceDeviation(bytes32,uint256)": string;
        };
        rawMetadata: string;
        metadata: {
            compiler: {
                version: string;
            };
            language: string;
            output: {
                abi: ({
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        indexed: boolean;
                    }[];
                    type: string;
                    name: string;
                    anonymous: boolean;
                    stateMutability?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: ({
                        internalType: string;
                        name: string;
                        type: string;
                        components?: undefined;
                    } | {
                        internalType: string;
                        name: string;
                        type: string;
                        components: {
                            internalType: string;
                            name: string;
                            type: string;
                        }[];
                    })[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    anonymous?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    anonymous?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        components: {
                            internalType: string;
                            name: string;
                            type: string;
                        }[];
                    }[];
                    anonymous?: undefined;
                })[];
                devdoc: {
                    kind: string;
                    methods: {
                        "addOracleSource(bytes32,(address,uint8,uint256,uint256,bool,uint256,uint256))": {
                            params: {
                                feedId: string;
                                source: string;
                            };
                        };
                        "emergencyPriceOverride(bytes32,uint256)": {
                            details: string;
                            params: {
                                feedId: string;
                                price: string;
                            };
                        };
                        "getConfidence(bytes32)": {
                            params: {
                                feedId: string;
                            };
                            returns: {
                                confidence: string;
                            };
                        };
                        "getConsensusPrice(bytes32)": {
                            params: {
                                feedId: string;
                            };
                            returns: {
                                consensusPrice: string;
                                numSources: string;
                            };
                        };
                        "getLastUpdate(bytes32)": {
                            params: {
                                feedId: string;
                            };
                            returns: {
                                timestamp: string;
                            };
                        };
                        "getOracleSources(bytes32)": {
                            params: {
                                feedId: string;
                            };
                            returns: {
                                sources: string;
                            };
                        };
                        "getPrice(bytes32)": {
                            params: {
                                feedId: string;
                            };
                            returns: {
                                price: string;
                            };
                        };
                        "getPriceData(bytes32)": {
                            params: {
                                feedId: string;
                            };
                            returns: {
                                priceData: string;
                            };
                        };
                        "getTWAP(bytes32,uint256)": {
                            params: {
                                feedId: string;
                                period: string;
                            };
                            returns: {
                                twapPrice: string;
                            };
                        };
                        "isPriceStale(bytes32)": {
                            params: {
                                feedId: string;
                            };
                            returns: {
                                stale: string;
                            };
                        };
                        "isPriceWithinBounds(bytes32,uint256,uint256)": {
                            params: {
                                feedId: string;
                                maxPrice: string;
                                minPrice: string;
                            };
                            returns: {
                                withinBounds: string;
                            };
                        };
                        "removeOracleSource(bytes32)": {
                            params: {
                                feedId: string;
                            };
                        };
                        "updatePrice(bytes32,uint256,uint256,uint256)": {
                            params: {
                                confidence: string;
                                feedId: string;
                                price: string;
                                timestamp: string;
                            };
                        };
                        "validatePriceDeviation(bytes32,uint256)": {
                            params: {
                                feedId: string;
                                maxDeviation: string;
                            };
                            returns: {
                                valid: string;
                            };
                        };
                    };
                    version: number;
                };
                userdoc: {
                    kind: string;
                    methods: {
                        "addOracleSource(bytes32,(address,uint8,uint256,uint256,bool,uint256,uint256))": {
                            notice: string;
                        };
                        "emergencyPriceOverride(bytes32,uint256)": {
                            notice: string;
                        };
                        "getConfidence(bytes32)": {
                            notice: string;
                        };
                        "getConsensusPrice(bytes32)": {
                            notice: string;
                        };
                        "getLastUpdate(bytes32)": {
                            notice: string;
                        };
                        "getOracleSources(bytes32)": {
                            notice: string;
                        };
                        "getPrice(bytes32)": {
                            notice: string;
                        };
                        "getPriceData(bytes32)": {
                            notice: string;
                        };
                        "getTWAP(bytes32,uint256)": {
                            notice: string;
                        };
                        "isPriceStale(bytes32)": {
                            notice: string;
                        };
                        "isPriceWithinBounds(bytes32,uint256,uint256)": {
                            notice: string;
                        };
                        "removeOracleSource(bytes32)": {
                            notice: string;
                        };
                        "updatePrice(bytes32,uint256,uint256,uint256)": {
                            notice: string;
                        };
                        "validatePriceDeviation(bytes32,uint256)": {
                            notice: string;
                        };
                    };
                    version: number;
                };
            };
            settings: {
                remappings: string[];
                optimizer: {
                    enabled: boolean;
                    runs: number;
                };
                metadata: {
                    bytecodeHash: string;
                };
                compilationTarget: {
                    "contracts/interfaces/IOracleAggregator.sol": string;
                };
                evmVersion: string;
                libraries: {};
            };
            sources: {
                "contracts/interfaces/IOracleAggregator.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
            };
            version: number;
        };
        id: number;
    };
    MarketRegistry: {
        abi: ({
            type: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            stateMutability: string;
            name?: undefined;
            outputs?: undefined;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            outputs: ({
                name: string;
                type: string;
                internalType: string;
                components?: undefined;
            } | {
                name: string;
                type: string;
                internalType: string;
                components: {
                    name: string;
                    type: string;
                    internalType: string;
                }[];
            })[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            outputs: {
                name: string;
                type: string;
                internalType: string;
                components: ({
                    name: string;
                    type: string;
                    internalType: string;
                    components?: undefined;
                } | {
                    name: string;
                    type: string;
                    internalType: string;
                    components: {
                        name: string;
                        type: string;
                        internalType: string;
                    }[];
                })[];
            }[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                indexed: boolean;
                internalType: string;
            }[];
            anonymous: boolean;
            stateMutability?: undefined;
            outputs?: undefined;
        })[];
        bytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        deployedBytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        methodIdentifiers: {
            "addMarket(string,bytes32,address,address,uint256,uint256,uint256,uint256,uint256,uint256)": string;
            "configRegistry()": string;
            "emergencyPause()": string;
            "emergencyResume()": string;
            "getActiveMarkets()": string;
            "getAllMarkets()": string;
            "getMarket(uint256)": string;
            "getMarketBySymbol(string)": string;
            "getMarketCount()": string;
            "getMarketHistory(uint256,uint256)": string;
            "getMarketIdBySymbol(string)": string;
            "getMarketStatus(uint256)": string;
            "isMarketActive(uint256)": string;
            "owner()": string;
            "paused()": string;
            "renounceOwnership()": string;
            "setConfigRegistry(address)": string;
            "setMarketStatus(uint256,bool)": string;
            "symbolExists(string)": string;
            "transferOwnership(address)": string;
            "updateMarket(uint256,uint256,uint256,uint256,uint256,uint256,uint256)": string;
            "updateOracleFeed(uint256,bytes32)": string;
            "validateMarket(uint256,uint256)": string;
        };
        rawMetadata: string;
        metadata: {
            compiler: {
                version: string;
            };
            language: string;
            output: {
                abi: ({
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name?: undefined;
                    anonymous?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        indexed: boolean;
                    }[];
                    type: string;
                    name: string;
                    anonymous: boolean;
                    stateMutability?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: ({
                        internalType: string;
                        name: string;
                        type: string;
                        components?: undefined;
                    } | {
                        internalType: string;
                        name: string;
                        type: string;
                        components: {
                            internalType: string;
                            name: string;
                            type: string;
                        }[];
                    })[];
                    anonymous?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        components: ({
                            internalType: string;
                            name: string;
                            type: string;
                            components?: undefined;
                        } | {
                            internalType: string;
                            name: string;
                            type: string;
                            components: {
                                internalType: string;
                                name: string;
                                type: string;
                            }[];
                        })[];
                    }[];
                    anonymous?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    anonymous?: undefined;
                    outputs?: undefined;
                })[];
                devdoc: {
                    kind: string;
                    methods: {
                        "owner()": {
                            details: string;
                        };
                        "paused()": {
                            details: string;
                        };
                        "renounceOwnership()": {
                            details: string;
                        };
                        "transferOwnership(address)": {
                            details: string;
                        };
                    };
                    version: number;
                };
                userdoc: {
                    kind: string;
                    methods: {
                        "emergencyPause()": {
                            notice: string;
                        };
                        "emergencyResume()": {
                            notice: string;
                        };
                        "getMarketCount()": {
                            notice: string;
                        };
                        "getMarketIdBySymbol(string)": {
                            notice: string;
                        };
                        "setConfigRegistry(address)": {
                            notice: string;
                        };
                        "symbolExists(string)": {
                            notice: string;
                        };
                    };
                    version: number;
                };
            };
            settings: {
                remappings: string[];
                optimizer: {
                    enabled: boolean;
                    runs: number;
                };
                metadata: {
                    bytecodeHash: string;
                };
                compilationTarget: {
                    "contracts/core/MarketRegistry.sol": string;
                };
                evmVersion: string;
                libraries: {};
            };
            sources: {
                "contracts/core/MarketRegistry.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IConfigRegistry.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IMarketRegistry.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IOracleAggregator.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/access/Ownable.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/security/Pausable.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/utils/Context.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
            };
            version: number;
        };
        id: number;
    };
    ProtocolConfig: {
        abi: ({
            type: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            stateMutability: string;
            name?: undefined;
            outputs?: undefined;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            outputs: {
                name: string;
                type: string;
                internalType: string;
                components: {
                    name: string;
                    type: string;
                    internalType: string;
                }[];
            }[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            outputs: {
                name: string;
                type: string;
                internalType: string;
            }[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: ({
                name: string;
                type: string;
                internalType: string;
                components?: undefined;
            } | {
                name: string;
                type: string;
                internalType: string;
                components: {
                    name: string;
                    type: string;
                    internalType: string;
                }[];
            })[];
            outputs: never[];
            stateMutability: string;
            anonymous?: undefined;
        } | {
            type: string;
            name: string;
            inputs: ({
                name: string;
                type: string;
                indexed: boolean;
                internalType: string;
                components?: undefined;
            } | {
                name: string;
                type: string;
                indexed: boolean;
                internalType: string;
                components: {
                    name: string;
                    type: string;
                    internalType: string;
                }[];
            })[];
            anonymous: boolean;
            stateMutability?: undefined;
            outputs?: undefined;
        } | {
            type: string;
            name: string;
            inputs: never[];
            stateMutability?: undefined;
            outputs?: undefined;
            anonymous?: undefined;
        })[];
        bytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        deployedBytecode: {
            object: string;
            sourceMap: string;
            linkReferences: {};
        };
        methodIdentifiers: {
            "cancelConfigUpdate(bytes32)": string;
            "emergencyDisableMarket(uint256)": string;
            "emergencyEnableMarket(uint256)": string;
            "executeConfigUpdate(bytes32)": string;
            "getConfigGuardian()": string;
            "getConfigVersion()": string;
            "getMarketConfig(uint256)": string;
            "getMaxPositionSize(uint256)": string;
            "getMinMargin(uint256,uint256)": string;
            "getProtocolConfig()": string;
            "getRiskConfig()": string;
            "getScheduledUpdate(bytes32)": string;
            "initializeMarket(uint256,(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256,uint256))": string;
            "isMarketActive(uint256)": string;
            "isUpdatePending(bytes32)": string;
            "owner()": string;
            "paused()": string;
            "renounceOwnership()": string;
            "scheduleConfigUpdate(bytes32,uint256)": string;
            "setTimelockController(address)": string;
            "timelockController()": string;
            "transferOwnership(address)": string;
            "updateConfigGuardian(address)": string;
            "updateMarketConfig(uint256,(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256,uint256))": string;
            "updateProtocolConfig((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,address,address))": string;
            "updateRiskConfig((uint256,uint256,uint256,uint256,uint256,uint256))": string;
            "validateMarketParameters(uint256,uint256,uint256)": string;
        };
        rawMetadata: string;
        metadata: {
            compiler: {
                version: string;
            };
            language: string;
            output: {
                abi: ({
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name?: undefined;
                    anonymous?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: never[];
                    type: string;
                    name: string;
                    stateMutability?: undefined;
                    anonymous?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: ({
                        internalType: string;
                        name: string;
                        type: string;
                        indexed: boolean;
                        components?: undefined;
                    } | {
                        internalType: string;
                        name: string;
                        type: string;
                        components: {
                            internalType: string;
                            name: string;
                            type: string;
                        }[];
                        indexed: boolean;
                    })[];
                    type: string;
                    name: string;
                    anonymous: boolean;
                    stateMutability?: undefined;
                    outputs?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: {
                        internalType: string;
                        name: string;
                        type: string;
                        components: {
                            internalType: string;
                            name: string;
                            type: string;
                        }[];
                    }[];
                    anonymous?: undefined;
                } | {
                    inputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    outputs: {
                        internalType: string;
                        name: string;
                        type: string;
                    }[];
                    anonymous?: undefined;
                } | {
                    inputs: ({
                        internalType: string;
                        name: string;
                        type: string;
                        components?: undefined;
                    } | {
                        internalType: string;
                        name: string;
                        type: string;
                        components: {
                            internalType: string;
                            name: string;
                            type: string;
                        }[];
                    })[];
                    stateMutability: string;
                    type: string;
                    name: string;
                    anonymous?: undefined;
                    outputs?: undefined;
                })[];
                devdoc: {
                    kind: string;
                    methods: {
                        "cancelConfigUpdate(bytes32)": {
                            params: {
                                configHash: string;
                            };
                        };
                        "emergencyDisableMarket(uint256)": {
                            params: {
                                marketId: string;
                            };
                        };
                        "emergencyEnableMarket(uint256)": {
                            params: {
                                marketId: string;
                            };
                        };
                        "executeConfigUpdate(bytes32)": {
                            params: {
                                configHash: string;
                            };
                        };
                        "getConfigGuardian()": {
                            returns: {
                                guardian: string;
                            };
                        };
                        "getMarketConfig(uint256)": {
                            params: {
                                marketId: string;
                            };
                            returns: {
                                config: string;
                            };
                        };
                        "getMaxPositionSize(uint256)": {
                            params: {
                                marketId: string;
                            };
                            returns: {
                                maxSize: string;
                            };
                        };
                        "getMinMargin(uint256,uint256)": {
                            params: {
                                marketId: string;
                                size: string;
                            };
                            returns: {
                                minMargin: string;
                            };
                        };
                        "getProtocolConfig()": {
                            returns: {
                                config: string;
                            };
                        };
                        "getRiskConfig()": {
                            returns: {
                                config: string;
                            };
                        };
                        "isMarketActive(uint256)": {
                            params: {
                                marketId: string;
                            };
                            returns: {
                                active: string;
                            };
                        };
                        "owner()": {
                            details: string;
                        };
                        "paused()": {
                            details: string;
                        };
                        "renounceOwnership()": {
                            details: string;
                        };
                        "scheduleConfigUpdate(bytes32,uint256)": {
                            params: {
                                configHash: string;
                                eta: string;
                            };
                        };
                        "transferOwnership(address)": {
                            details: string;
                        };
                        "updateConfigGuardian(address)": {
                            params: {
                                newGuardian: string;
                            };
                        };
                        "updateMarketConfig(uint256,(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256,uint256))": {
                            params: {
                                marketId: string;
                                newConfig: string;
                            };
                        };
                        "updateProtocolConfig((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,address,address))": {
                            params: {
                                newConfig: string;
                            };
                        };
                        "updateRiskConfig((uint256,uint256,uint256,uint256,uint256,uint256))": {
                            params: {
                                newConfig: string;
                            };
                        };
                        "validateMarketParameters(uint256,uint256,uint256)": {
                            params: {
                                leverage: string;
                                marketId: string;
                                size: string;
                            };
                            returns: {
                                valid: string;
                            };
                        };
                    };
                    version: number;
                };
                userdoc: {
                    kind: string;
                    methods: {
                        "cancelConfigUpdate(bytes32)": {
                            notice: string;
                        };
                        "emergencyDisableMarket(uint256)": {
                            notice: string;
                        };
                        "emergencyEnableMarket(uint256)": {
                            notice: string;
                        };
                        "executeConfigUpdate(bytes32)": {
                            notice: string;
                        };
                        "getConfigGuardian()": {
                            notice: string;
                        };
                        "getConfigVersion()": {
                            notice: string;
                        };
                        "getMarketConfig(uint256)": {
                            notice: string;
                        };
                        "getMaxPositionSize(uint256)": {
                            notice: string;
                        };
                        "getMinMargin(uint256,uint256)": {
                            notice: string;
                        };
                        "getProtocolConfig()": {
                            notice: string;
                        };
                        "getRiskConfig()": {
                            notice: string;
                        };
                        "getScheduledUpdate(bytes32)": {
                            notice: string;
                        };
                        "initializeMarket(uint256,(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256,uint256))": {
                            notice: string;
                        };
                        "isMarketActive(uint256)": {
                            notice: string;
                        };
                        "isUpdatePending(bytes32)": {
                            notice: string;
                        };
                        "scheduleConfigUpdate(bytes32,uint256)": {
                            notice: string;
                        };
                        "setTimelockController(address)": {
                            notice: string;
                        };
                        "updateConfigGuardian(address)": {
                            notice: string;
                        };
                        "updateMarketConfig(uint256,(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint256,uint256))": {
                            notice: string;
                        };
                        "updateProtocolConfig((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,address,address))": {
                            notice: string;
                        };
                        "updateRiskConfig((uint256,uint256,uint256,uint256,uint256,uint256))": {
                            notice: string;
                        };
                        "validateMarketParameters(uint256,uint256,uint256)": {
                            notice: string;
                        };
                    };
                    version: number;
                };
            };
            settings: {
                remappings: string[];
                optimizer: {
                    enabled: boolean;
                    runs: number;
                };
                metadata: {
                    bytecodeHash: string;
                };
                compilationTarget: {
                    "contracts/core/ProtocolConfig.sol": string;
                };
                evmVersion: string;
                libraries: {};
            };
            sources: {
                "contracts/core/ProtocolConfig.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/IConfigRegistry.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/interfaces/ITimelockController.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "contracts/libraries/SafeDecimalMath.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/access/Ownable.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/security/Pausable.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/utils/Context.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
                "node_modules/@openzeppelin/contracts/utils/math/Math.sol": {
                    keccak256: string;
                    urls: string[];
                    license: string;
                };
            };
            version: number;
        };
        id: number;
    };
};
export default ABIs;
//# sourceMappingURL=index.d.ts.map