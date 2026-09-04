import { createPublicClient, http, namehash, labelhash } from "viem";
import { sepolia } from "viem/chains";

const client = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
const REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const CONTROLLER = "0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72";

const registryAbi = [
  { name: "owner", type: "function", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
  { name: "resolver", type: "function", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
];
const ctrlAbi = [
  { name: "available", type: "function", stateMutability: "view", inputs: [{ name: "name", type: "string" }], outputs: [{ type: "bool" }] },
  { name: "rentPrice", type: "function", stateMutability: "view", inputs: [{ name: "name", type: "string" }, { name: "duration", type: "uint256" }], outputs: [{ components: [{ name: "base", type: "uint256" }, { name: "premium", type: "uint256" }], type: "tuple" }] },
];

console.log("block:", await client.getBlockNumber());
for (const label of ["privatecredit", "commons3nse", "s3nsecredit", "alice", "vault"]) {
  try {
    const avail = await client.readContract({ address: CONTROLLER, abi: ctrlAbi, functionName: "available", args: [label] });
    let price = "-";
    if (avail) {
      const p = await client.readContract({ address: CONTROLLER, abi: ctrlAbi, functionName: "rentPrice", args: [label, 31536000n] });
      price = (Number(p.base + p.premium) / 1e18).toFixed(5) + " ETH/yr";
    }
    const owner = await client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "owner", args: [namehash(`${label}.eth`)] });
    console.log(`${label}.eth  available=${avail}  ${price}  registryOwner=${owner}`);
  } catch (e) { console.log(`${label}.eth  ERROR ${String(e).slice(0, 90)}`); }
}
// prove wildcard/CCIP support matters: check a subname node has no resolver by default
console.log("\nsubname resolver (loan1.privatecredit.eth):",
  await client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "resolver", args: [namehash("loan1.privatecredit.eth")] }));
