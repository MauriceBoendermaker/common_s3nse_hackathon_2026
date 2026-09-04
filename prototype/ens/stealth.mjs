import { secp256k1 as S } from '@noble/curves/secp256k1.js'
import { keccak256, bytesToHex, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const G = S.Point.BASE
const N = S.Point.Fn.ORDER
const pubToAddr = (P) => '0x' + keccak256(P.toBytes(false).slice(1)).slice(-40)

// ---------- RECIPIENT (borrower) generates once, from a wallet signature in the real app ----------
const spendPriv = S.utils.randomSecretKey()
const viewPriv  = S.utils.randomSecretKey()
const spendPub  = S.getPublicKey(spendPriv, true)   // 33-byte compressed
const viewPub   = S.getPublicKey(viewPriv,  true)
const meta = `st:eth:0x${bytesToHex(spendPub).slice(2)}${bytesToHex(viewPub).slice(2)}`
console.log('ENS text record value  stealth-meta-address[1] =')
console.log('  ' + meta)
console.log('  hex payload length =', meta.split('0x')[1].length, '(spec: 132)')

function senderDerive(metaStr) {
  const hex = metaStr.split('0x')[1]
  const spend = S.Point.fromHex(hex.slice(0,66))
  const view  = S.Point.fromHex(hex.slice(66,132))
  const ephPriv = S.utils.randomSecretKey()
  const ephPub  = S.getPublicKey(ephPriv, true)
  const shared  = S.getSharedSecret(ephPriv, view.toBytes(true), true) // 33B compressed
  const sh      = keccak256(shared)
  const Sh      = G.multiply(BigInt(sh) % N)
  const Pst     = spend.add(Sh)
  return { stealthAddress: pubToAddr(Pst), ephemeralPubKey: bytesToHex(ephPub), viewTag: sh.slice(0,4) }
}
function recipientCheck({ ephemeralPubKey, viewTag }) {
  const shared = S.getSharedSecret(viewPriv, hexToBytes(ephemeralPubKey), true)
  const sh = keccak256(shared)
  if (sh.slice(0,4) !== viewTag) return null                 // cheap filter, 1/256 survive
  const Pst = S.Point.fromBytes(spendPub).add(G.multiply(BigInt(sh) % N))
  const stealthPriv = (BigInt(bytesToHex(spendPriv)) + BigInt(sh)) % N
  return { addr: pubToAddr(Pst), priv: '0x'+stealthPriv.toString(16).padStart(64,'0') }
}

console.log('\nThree successive draws to the SAME ENS name:')
let allOk = true
for (let i=1;i<=3;i++){
  const ann = senderDerive(meta)
  const got = recipientCheck(ann)
  const spendable = got && privateKeyToAccount(got.priv).address.toLowerCase() === ann.stealthAddress
  allOk = allOk && !!got && spendable
  console.log(` draw ${i}: ${ann.stealthAddress}  viewTag ${ann.viewTag}  scan:${got?'found':'MISS'}  spendable:${spendable?'YES':'NO'}`)
}
// negative: a different recipient must NOT match
const otherView = S.utils.randomSecretKey()
const ann = senderDerive(meta)
const sharedWrong = S.getSharedSecret(otherView, hexToBytes(ann.ephemeralPubKey), true)
console.log('\nUnrelated observer viewTag:', keccak256(sharedWrong).slice(0,4), 'vs real', ann.viewTag, '-> unlinkable')
console.log('\nRESULT:', allOk ? 'ROUND TRIP OK' : 'FAILED')
