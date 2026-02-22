if(!BigInt.prototype.mul){BigInt.prototype.mul=function(x){return this*BigInt(x)};BigInt.prototype.div=function(x){return this/BigInt(x)};BigInt.prototype.add=function(x){return this+BigInt(x)};BigInt.prototype.sub=function(x){return this-BigInt(x)};BigInt.prototype.gt=function(x){return this>BigInt(x)};BigInt.prototype.lt=function(x){return this<BigInt(x)};BigInt.prototype.gte=function(x){return this>=BigInt(x)};BigInt.prototype.lte=function(x){return this<=BigInt(x)};BigInt.prototype.eq=function(x){return this==BigInt(x)}};
/**
 * Ethers v6 Compatibility Helper
 * Adds v5 BigNumber methods to BigInt prototype for easier migration
 */
if (!BigInt.prototype.mul) {
    BigInt.prototype.mul = function(x) { return this * BigInt(x); };
    BigInt.prototype.div = function(x) { return this / BigInt(x); };
    BigInt.prototype.add = function(x) { return this + BigInt(x); };
    BigInt.prototype.sub = function(x) { return this - BigInt(x); };
    BigInt.prototype.gt = function(x) { return this > BigInt(x); };
    BigInt.prototype.lt = function(x) { return this < BigInt(x); };
    BigInt.prototype.gte = function(x) { return this >= BigInt(x); };
    BigInt.prototype.lte = function(x) { return this <= BigInt(x); };
    BigInt.prototype.eq = function(x) { return this == BigInt(x); };
}
