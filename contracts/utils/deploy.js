// scripts/deploy.js
// Deploy DMAP, SignalVault via Create2Factory to Base network
const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

  // Deploy DMAP
  console.log("\nDeploying DMAP...");
  const DMAP = await ethers.getContractFactory("DMAP");
  const dmap = await DMAP.deploy();
  await dmap.deployed();
  console.log("DMAP deployed at:", dmap.address);

  // Deploy SignalVault
  console.log("\nDeploying SignalVault...");
  const SignalVault = await ethers.getContractFactory("SignalVault");
  const vault = await SignalVault.deploy(dmap.address, deployer.address);
  await vault.deployed();
  console.log("SignalVault deployed at:", vault.address);

  // Deploy Honeypot
  console.log("\nDeploying Honeypot...");
  const Honeypot = await ethers.getContractFactory("Honeypot");
  const honeypot = await Honeypot.deploy(dmap.address, vault.address, deployer.address);
  await honeypot.deployed();
  console.log("Honeypot deployed at:", honeypot.address);

  // Authorize honeypot in vault
  console.log("\nAuthorizing honeypot...");
  const authTx = await vault.setAuthorizedTrapper(honeypot.address, true);
  await authTx.wait();
  console.log("Honeypot authorized in vault");

  // Verify authorization
  const isAuthorized = await vault.authorizedTrappers(honeypot.address);
  console.log("Authorization verified:", isAuthorized);

  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log("DMAP:", dmap.address);
  console.log("SignalVault:", vault.address);
  console.log("Honeypot:", honeypot.address);

  // Write deployment report
  const fs = require('fs');
  const path = require('path');
  const report = {
    timestamp: Math.floor(Date.now() / 1000),
    network: "base",
    deployer: deployer.address,
    dmap: dmap.address,
    vault: vault.address,
    honeypot: honeypot.address
  };
  const outputFile = path.resolve(__dirname, '../deployment.json');
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log('\nDeployment report written to:', outputFile);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
