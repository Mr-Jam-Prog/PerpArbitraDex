import re
import os

def migrate_file(filepath):
    print(f"Migrating {filepath}...")
    with open(filepath, 'r') as f:
        content = f.read()

    # Simple replacements
    content = content.replace('ethers.utils.parseUnits', 'ethers.parseUnits')
    content = content.replace('ethers.utils.parseEther', 'ethers.parseEther')
    content = content.replace('ethers.utils.formatUnits', 'ethers.formatUnits')
    content = content.replace('ethers.utils.formatEther', 'ethers.formatEther')
    content = content.replace('ethers.utils.keccak256', 'ethers.keccak256')
    content = content.replace('ethers.utils.toUtf8Bytes', 'ethers.toUtf8Bytes')
    content = content.replace('ethers.utils.defaultAbiCoder', 'ethers.AbiCoder.defaultAbiCoder()')
    content = content.replace('ethers.constants.AddressZero', 'ethers.ZeroAddress')
    content = content.replace('ethers.constants.MaxUint256', 'ethers.MaxUint256')
    
    # Destructuring
    content = content.replace('const { parseUnits } = ethers.utils;', 'const { parseUnits } = ethers;')
    content = content.replace('const { parseUnits, formatUnits } = ethers.utils;', 'const { parseUnits, formatUnits } = ethers;')
    content = content.replace('const { parseEther, formatEther } = ethers.utils;', 'const { parseEther, formatEther } = ethers;')

    content = re.sub(r'await (.*)\.deployed\(\)', r'await \1.waitForDeployment()', content)

    with open(filepath, 'w') as f:
        f.write(content)

# Define directories to scan
directories = ['test/unit', 'test/integration', 'test/fork', 'test/simulation', 'test/audit']
for directory in directories:
    if os.path.exists(directory):
        print(f"Scanning directory: {directory}")
        for root, dirs, files in os.walk(directory):
            for filename in files:
                if filename.endswith('.cjs') or filename.endswith('.js'):
                    migrate_file(os.path.join(root, filename))
    else:
        print(f"Directory {directory} does not exist.")
