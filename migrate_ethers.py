import re
import os

def migrate_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Simple replacements
    content = content.replace('ethers.utils.parseUnits', 'ethers.parseUnits')
    content = content.replace('ethers.utils.parseEther', 'ethers.parseEther')
    content = content.replace('ethers.constants.AddressZero', 'ethers.ZeroAddress')
    content = content.replace('ethers.constants.MaxUint256', 'ethers.MaxUint256')
    content = re.sub(r'await (.*)\.deployed\(\)', r'await \1.waitForDeployment()', content)
    
    # Replace BigNumber methods with BigInt operators
    # This is a simplified regex-based replacement, might not catch everything
    content = re.sub(r'\.add\((.*?)\)', r' + (\1)', content)
    content = re.sub(r'\.sub\((.*?)\)', r' - (\1)', content)
    content = re.sub(r'\.mul\((.*?)\)', r' * (\1)', content)
    content = re.sub(r'\.div\((.*?)\)', r' / (\1)', content)
    content = re.sub(r'\.eq\((.*?)\)', r' == (\1)', content)
    content = re.sub(r'\.gt\((.*?)\)', r' > (\1)', content)
    content = re.sub(r'\.lt\((.*?)\)', r' < (\1)', content)
    content = re.sub(r'\.gte\((.*?)\)', r' >= (\1)', content)
    content = re.sub(r'\.lte\((.*?)\)', r' <= (\1)', content)
    content = re.sub(r'\.abs\(\)', r'((val => val < 0n ? -val : val)(\0))', content) # Hacky abs
    
    # Replace .address with await .getAddress()
    # Only for specific known contract variables or in general?
    # content = re.sub(r'([a-zA-Z0-9_]+)\.address', r'(await \1.getAddress())', content)

    with open(filepath, 'w') as f:
        f.write(content)

for filename in os.listdir('test/unit'):
    if filename.endswith('.cjs'):
        migrate_file(os.path.join('test/unit', filename))
