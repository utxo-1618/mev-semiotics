const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

// --- Utility Functions ---
const log = (message, color = 'reset') => {
    console.log(colors[color] + message + colors.reset);
};

const executeCommand = (command, live = false) => {
    if (live) {
        return new Promise((resolve, reject) => {
            const child = require('child_process').spawn(command, { shell: true, stdio: 'inherit' });
            child.on('close', code => code === 0 ? resolve() : reject(new Error(`Command exited with code ${code}`)))
            child.on('error', err => reject(err));
        });
    }
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) return reject(error);
            resolve({ stdout, stderr });
        });
    });
};

const getVaultContract = async () => {
    const vaultAbiPath = path.join(__dirname, 'artifacts/contracts/SignalVault.sol/SignalVault.json');
    if (!fs.existsSync(vaultAbiPath)) {
        throw new Error('Missing ABI file. Run `npx hardhat compile` first.');
    }
    const vaultAbi = require(vaultAbiPath).abi;
    
    const { RPC_URL, PRIVATE_KEY } = process.env;
    const VAULT_ADDRESS = process.env.VAULT_ADDRESS || '__VAULT_ADDRESS__';
    if (!RPC_URL || !PRIVATE_KEY || !VAULT_ADDRESS || VAULT_ADDRESS === '__VAULT_ADDRESS__') {
        throw new Error('Missing required environment variables (RPC_URL, PRIVATE_KEY, VAULT_ADDRESS).');
    }

    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    return new ethers.Contract(VAULT_ADDRESS, vaultAbi, wallet);
};

// --- Command Handlers ---

const pm2Command = (action, component, flags = '') => async () => {
    const componentName = component || (action === 'stop' ? 'all' : 'ecosystem.config.js');
    const friendlyName = component || 'system';
    log(`pm2_${action}=start component=${friendlyName}`, 'yellow');
    try {
        await executeCommand(`pm2 ${action} ${componentName} ${flags}`);
        log(`pm2_${action}=done component=${friendlyName}`, 'green');
    } catch (error) {
        log(`pm2_${action}=error component=${friendlyName} err="${error.message}"`, 'red');
    }
};

const commands = {
    start: pm2Command('start'),
    stop: pm2Command('stop'),
    restart: pm2Command('restart', null, '--update-env'),

    async status() {
        log('status=checking', 'cyan');
        try {
            const { stdout } = await executeCommand('pm2 list');
            console.log(stdout);
        } catch (error) {
            log(`status=error err="${error.message}"`, 'red');
        }
    },

    async test() {
        log('test=start', 'cyan');
        try {
            await executeCommand('npx hardhat test', true);
            log('test=done', 'green');
        } catch (error) {
            log('test=error', 'red');
        }
    },

    async logs(args) {
        const component = args[0] || '';
        const lines = args[1] || '100';
        log(`logs=fetch component=${component || 'all'} lines=${lines}`, 'cyan');
        try {
            await executeCommand(`pm2 logs ${component} --lines ${lines}`, true);
        } catch (error) {
            // Error is handled by live output, just need to catch promise rejection
        }
    },

    async clean() {
        log('clean=start', 'yellow');
        try {
            await executeCommand('pm2 flush');
            log('clean=done', 'green');
        } catch (error) {
            log(`clean=error err="${error.message}"`, 'red');
        }
    },

    async monitor() {
        log('monitor=start', 'cyan');
        try {
            await executeCommand('node monitor.js', true);
        } catch (error) {
            log('monitor=exit', 'yellow');
        }
    },

    async 'set-lz-endpoint'(args) {
        const [endpointAddress] = args;
        if (!endpointAddress) return log('Usage: node manage.js set-lz-endpoint <address>', 'red');
        log(`lz_endpoint=set addr=${endpointAddress}`, 'cyan');
        try {
            const vault = await getVaultContract();
            const tx = await vault.setLayerZeroEndpoint(endpointAddress);
            log(`tx=sent hash=${tx.hash}`, 'yellow');
            await tx.wait();
            log('lz_endpoint=done', 'green');
        } catch (error) {
            log(`lz_endpoint=error err="${error.message}"`, 'red');
        }
    },

    async 'add-lz-remote'(args) {
        const [chainId, remoteAddress] = args;
        if (!chainId || !remoteAddress) return log('Usage: node manage.js add-lz-remote <chainId> <address>', 'red');
        log(`lz_remote=add chain=${chainId} addr=${remoteAddress}`, 'cyan');
        try {
            const vault = await getVaultContract();
            const tx = await vault.setRemote(chainId, remoteAddress);
            log(`tx=sent hash=${tx.hash}`, 'yellow');
            await tx.wait();
            log('lz_remote=done', 'green');
        } catch (error) {
            log(`lz_remote=error err="${error.message}"`, 'red');
        }
    },

    async 'bridge-yield'(args) {
        const [chainId, toAddress, amount] = args;
        if (!chainId || !toAddress || !amount) return log('Usage: node manage.js bridge-yield <chainId> <toAddress> <amount>', 'red');
        log(`bridge=start chain=${chainId} to=${toAddress} amount=${amount}`, 'cyan');
        try {
            const vault = await getVaultContract();
            const lzFee = ethers.utils.parseEther("0.01"); // Example fee
            const tx = await vault.withdrawYieldToChain(chainId, toAddress, ethers.utils.parseEther(amount), { value: lzFee });
            log(`tx=sent hash=${tx.hash}`, 'yellow');
            await tx.wait();
            log('bridge=done', 'green');
        } catch (error) {
            log(`bridge=error err="${error.message}"`, 'red');
        }
    },

    help() {
        log('cmd=help', 'bright');
        const helpText = [
            'start            [start=all]',
            'stop             [stop=all]',
            'restart          [restart=all refresh=env]',
            'status           [status=show]',
            'logs [svc]       [logs=tail service=<svc>]',
            'test             [test=run]',
            'monitor          [monitor=start]',
            'clean            [clean=logs]',
            'set-lz-endpoint  [lz=set endpoint=<addr>]',
            'add-lz-remote    [lz=add chain=<id> addr=<addr>]',
            'bridge-yield     [bridge=yield chain=<id> to=<addr> amt=<amt>]',
            'help             [help=show]'
        ];
        console.log('');
        helpText.forEach(cmd => {
            console.log(`  ${colors.green}${cmd}${colors.reset}`);
        });
        console.log('\n');
    }
};
// Main execution loop
const main = async () => {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    const commandArgs = args.slice(1);

    if (commands[command]) {
        await commands[command](commandArgs);
    } else {
        log(`Unknown command: ${command}`, 'red');
        commands.help();
    }
};

main().catch(error => {
    log(`fatal=error err="${error.message}"`, 'red');
    process.exit(1);
});
