/**
 * @jest-environment node
 */
import { once } from "events"
import { createChainAddress, subscribeToTransactions } from "lightning"
import { filter, first } from "lodash"
import mongoose from "mongoose"
import { yamlConfig } from "../config"
import { onchainTransactionEventHandler } from "../entrypoint/trigger"
import { MainBook, setupMongoConnection } from "../mongodb"
import { getTitle } from "../notifications/payment"
import { Transaction } from "../schema"
import { bitcoindDefaultClient, sleep } from "../utils"
import {
  checkIsBalanced,
  getUserWallet,
  lndonchain,
  lndOutside1,
  mockGetExchangeBalance,
  RANDOM_ADDRESS,
  waitUntilBlockHeight,
} from "./helper"

jest.mock("../realtimePrice")

const date = Date.now() + 1000 * 60 * 60 * 24 * 8

jest.spyOn(global.Date, "now").mockImplementation(() => new Date(date).valueOf())

let initBlockCount
let initialBalanceUser0
let userWallet0, userWallet1, userWallet2, userWallet3 // using userWallet1 and userWallet2 to sendAll

jest.mock("../notifications/notification")
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendNotification } = require("../notifications/notification")

beforeAll(async () => {
  await setupMongoConnection()
  userWallet0 = await getUserWallet(0)
  userWallet1 = await getUserWallet(1)
  userWallet2 = await getUserWallet(2)
  userWallet3 = await getUserWallet(3)
  mockGetExchangeBalance()
})

beforeEach(async () => {
  initBlockCount = await bitcoindDefaultClient.getBlockCount()
  ;({ BTC: initialBalanceUser0 } = await userWallet0.getBalances())
})

afterEach(async () => {
  await checkIsBalanced()
})

afterAll(async () => {
  await bitcoindDefaultClient.generateToAddress(3, RANDOM_ADDRESS)
  await sleep(2000)
  jest.restoreAllMocks()
  await mongoose.connection.close()
})

const amount = 10040 // sats

it("SendsOnchainPaymentSuccessfully", async () => {
  const { address } = await createChainAddress({ format: "p2wpkh", lnd: lndOutside1 })

  const sub = subscribeToTransactions({ lnd: lndonchain })
  sub.on("chain_transaction", onchainTransactionEventHandler)

  {
    const results = await Promise.all([
      once(sub, "chain_transaction"),
      userWallet0.onChainPay({ address, amount }),
    ])

    expect(results[1]).toBeTruthy()
    await onchainTransactionEventHandler(results[0][0])
  }

  // we don't send a notification for send transaction for now
  // expect(sendNotification.mock.calls.length).toBe(1)
  // expect(sendNotification.mock.calls[0][0].data.type).toBe("onchain_payment")
  // expect(sendNotification.mock.calls[0][0].data.title).toBe(`Your transaction has been sent. It may takes some time before it is confirmed`)

  // FIXME: does this syntax always take the first match item in the array? (which is waht we want, items are return as newest first)
  const {
    results: [pendingTxn],
  } = await MainBook.ledger({ account: userWallet0.accountPath, pending: true })

  const { BTC: interimBalance } = await userWallet0.getBalances()
  expect(interimBalance).toBe(initialBalanceUser0 - amount - pendingTxn.fee)
  await checkIsBalanced()

  const txs = await userWallet0.getTransactions()
  const pendingTxs = filter(txs, { pending: true })
  expect(pendingTxs.length).toBe(1)
  expect(pendingTxs[0].amount).toBe(-amount - pendingTxs[0].fee)

  // const subSpend = subscribeToChainSpend({ lnd: lndonchain, bech32_address: address, min_height: 1 })

  {
    await Promise.all([
      once(sub, "chain_transaction"),
      waitUntilBlockHeight({ lnd: lndonchain, blockHeight: initBlockCount + 6 }),
      bitcoindDefaultClient.generateToAddress(6, RANDOM_ADDRESS),
    ])
  }

  await sleep(1000)
  console.log(JSON.stringify(sendNotification.mock.calls))

  // expect(sendNotification.mock.calls.length).toBe(2)  // FIXME: should be 1

  expect(sendNotification.mock.calls[0][0].title).toBe(
    getTitle["onchain_payment"]({ amount }),
  )
  expect(sendNotification.mock.calls[0][0].data.type).toBe("onchain_payment")

  const {
    results: [{ pending, fee, feeUsd }],
  } = await MainBook.ledger({ account: userWallet0.accountPath, hash: pendingTxn.hash })

  expect(pending).toBe(false)
  expect(fee).toBe(yamlConfig.fees.withdraw + 7050)
  expect(feeUsd).toBeGreaterThan(0)

  const [txn] = (await userWallet0.getTransactions()).filter(
    (tx) => tx.hash === pendingTxn.hash,
  )
  expect(txn.amount).toBe(-amount - fee)
  expect(txn.type).toBe("onchain_payment")

  const { BTC: finalBalance } = await userWallet0.getBalances()
  expect(finalBalance).toBe(initialBalanceUser0 - amount - fee)
})

it("SendsOnchainSendAllPaymentSuccessfully", async () => {
  const { address } = await createChainAddress({ format: "p2wpkh", lnd: lndOutside1 })

  const sub = subscribeToTransactions({ lnd: lndonchain })
  sub.on("chain_transaction", onchainTransactionEventHandler)

  const { BTC: initialBalanceUser1 } = await userWallet1.getBalances()

  {
    const results = await Promise.all([
      once(sub, "chain_transaction"),
      userWallet1.onChainPay({ address, amount: 0, sendAll: true }),
    ])

    expect(results[1]).toBeTruthy()
    await onchainTransactionEventHandler(results[0][0])
  }

  // we don't send a notification for send transaction for now
  // expect(sendNotification.mock.calls.length).toBe(1)
  // expect(sendNotification.mock.calls[0][0].data.type).toBe("onchain_payment")
  // expect(sendNotification.mock.calls[0][0].data.title).toBe(`Your transaction has been sent. It may takes some time before it is confirmed`)

  // FIXME: does this syntax always take the first match item in the array? (which is waht we want, items are return as newest first)
  const {
    results: [pendingTxn],
  } = await MainBook.ledger({ account: userWallet1.accountPath, pending: true })

  const { BTC: interimBalance } = await userWallet1.getBalances()
  expect(interimBalance).toBe(0)
  await checkIsBalanced()

  const txs = await userWallet1.getTransactions()
  const pendingTxs = filter(txs, { pending: true })
  expect(pendingTxs.length).toBe(1)
  expect(pendingTxs[0].amount).toBe(-initialBalanceUser1)

  // const subSpend = subscribeToChainSpend({ lnd: lndonchain, bech32_address: address, min_height: 1 })

  {
    await Promise.all([
      once(sub, "chain_transaction"),
      waitUntilBlockHeight({ lnd: lndonchain, blockHeight: initBlockCount + 6 }),
      bitcoindDefaultClient.generateToAddress(6, RANDOM_ADDRESS),
    ])
  }

  await sleep(1000)
  console.log(JSON.stringify(sendNotification.mock.calls))

  // expect(sendNotification.mock.calls.length).toBe(2)  // FIXME: should be 1

  /// TODO Still showing amount, find where this happens...
  // expect(sendNotification.mock.calls[0][0].title).toBe(
  //   getTitle["onchain_payment"]({ amount: initialBalanceUser1 }),
  // )
  expect(sendNotification.mock.calls[0][0].data.type).toBe("onchain_payment")

  const {
    results: [{ pending, fee, feeUsd }],
  } = await MainBook.ledger({ account: userWallet1.accountPath, hash: pendingTxn.hash })

  expect(pending).toBe(false)
  expect(fee).toBe(yamlConfig.fees.withdraw + 7050) // 7050?
  expect(feeUsd).toBeGreaterThan(0)

  const [txn] = (await userWallet1.getTransactions()).filter(
    (tx) => tx.hash === pendingTxn.hash,
  )
  expect(txn.amount).toBe(-initialBalanceUser1)
  expect(txn.type).toBe("onchain_payment")

  const { BTC: finalBalance } = await userWallet1.getBalances()
  expect(finalBalance).toBe(0)
})

it("makesOnchainOnUsTransaction", async () => {
  const user3Address = await userWallet3.getOnChainAddress()
  const { BTC: initialBalanceUser3 } = await userWallet3.getBalances()

  const paymentResult = await userWallet0.onChainPay({ address: user3Address, amount })

  const { BTC: finalBalanceUser0 } = await userWallet0.getBalances()
  const { BTC: finalBalanceUser3 } = await userWallet3.getBalances()

  console.log({
    initialBalanceUser0,
    finalBalanceUser0,
    initialBalanceUser3,
    finalBalanceUser3,
  })

  expect(paymentResult).toBe(true)
  expect(finalBalanceUser0).toBe(initialBalanceUser0 - amount)
  expect(finalBalanceUser3).toBe(initialBalanceUser3 + amount)

  const {
    results: [{ pending, fee, feeUsd }],
  } = await MainBook.ledger({ account: userWallet0.accountPath, type: "onchain_on_us" })
  expect(pending).toBe(false)
  expect(fee).toBe(0)
  expect(feeUsd).toBe(0)
})

it("makesOnchainOnUsSendAllTransaction", async () => {
  const { BTC: initialBalanceUser2 } = await userWallet2.getBalances()

  const user3Address = await userWallet3.getOnChainAddress()
  const { BTC: initialBalanceUser3 } = await userWallet3.getBalances()

  const paymentResult = await userWallet2.onChainPay({ address: user3Address, amount: 0, sendAll: true })

  const { BTC: finalBalanceUser2 } = await userWallet2.getBalances()
  const { BTC: finalBalanceUser3 } = await userWallet3.getBalances()

  console.log({
    initialBalanceUser2,
    finalBalanceUser2,
    initialBalanceUser3,
    finalBalanceUser3,
  })

  expect(paymentResult).toBe(true)
  expect(finalBalanceUser2).toBe(0)
  expect(finalBalanceUser3).toBe(initialBalanceUser3 + initialBalanceUser2)

  const {
    results: [{ pending, fee, feeUsd }],
  } = await MainBook.ledger({ account: userWallet2.accountPath, type: "onchain_on_us" })
  expect(pending).toBe(false)
  expect(fee).toBe(0)
  expect(feeUsd).toBe(0)
})

it("sendsOnchainPaymentWithMemo", async () => {
  const memo = "this is my onchain memo"
  const { address } = await createChainAddress({ format: "p2wpkh", lnd: lndOutside1 })
  const paymentResult = await userWallet0.onChainPay({ address, amount, memo })
  expect(paymentResult).toBe(true)
  const txs: Record<string, string>[] = await userWallet0.getTransactions()
  const firstTxs = first(txs)
  if (!firstTxs) {
    throw Error("No transactions found")
  }
  expect(firstTxs.description).toBe(memo)
})

it("makesOnchainOnUsTransactionWithMemo", async () => {
  const memo = "this is my onchain memo"
  const user3Address = await userWallet3.getOnChainAddress()
  const paymentResult = await userWallet0.onChainPay({
    address: user3Address as string,
    amount,
    memo,
  })
  expect(paymentResult).toBe(true)

  let firstTxs

  const txs: Record<string, string>[] = await userWallet0.getTransactions()
  firstTxs = first(txs)
  if (!firstTxs) {
    throw Error("No transactions found")
  }
  expect(firstTxs.description).toBe(memo)

  // receiver should not know memo from sender
  const txsUser3 = await userWallet3.getTransactions()
  firstTxs = first(txsUser3)
  if (!firstTxs) {
    throw Error("No transactions found")
  }
  expect(firstTxs.description).not.toBe(memo)
})

it("failsToMakeOnchainPaymentToSelf", async () => {
  const address = await userWallet0.getOnChainAddress()
  await expect(userWallet0.onChainPay({ address, amount })).rejects.toThrow()
})

it("failsToMakeOnchainSendAllPaymentWithNonZeroAmount", async () => {
  const address = await userWallet3.getOnChainAddress()
  await expect(userWallet0.onChainPay({ address, amount, sendAll: true })).rejects.toThrow()
})

it("failsToMakeOnUsOnchainPaymentWhenInsufficientBalance", async () => {
  const address = await userWallet3.getOnChainAddress()
  await expect(
    userWallet0.onChainPay({ address, amount: initialBalanceUser0 + 1 }),
  ).rejects.toThrow()
})

it("failsToMakeOnchainPaymentWhenInsufficientBalance", async () => {
  const { address } = await createChainAddress({
    lnd: lndOutside1,
    format: "p2wpkh",
  })
  const { BTC: initialBalanceUser3 } = await userWallet3.getBalances()

  //should fail because user does not have balance to pay for on-chain fee
  await expect(
    userWallet3.onChainPay({ address: address as string, amount: initialBalanceUser3 }),
  ).rejects.toThrow()
})

it("negativeAmountIsRejected", async () => {
  const amount = -1000
  const { address } = await createChainAddress({ format: "p2wpkh", lnd: lndOutside1 })
  await expect(userWallet0.onChainPay({ address, amount })).rejects.toThrow()
})

it("failsToMakeOnchainPaymentWhenWithdrawalLimitHit", async () => {
  const { address } = await createChainAddress({
    lnd: lndOutside1,
    format: "p2wpkh",
  })

  const timestampYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [result] = await Transaction.aggregate([
    {
      $match: {
        accounts: userWallet0.accountPath,
        type: { $ne: "on_us" },
        timestamp: { $gte: timestampYesterday },
      },
    },
    { $group: { _id: null, outgoingSats: { $sum: "$debit" } } },
  ])
  const { outgoingSats } = result || { outgoingSats: 0 }
  const amount = yamlConfig.withdrawalLimit - outgoingSats

  await expect(userWallet0.onChainPay({ address, amount })).rejects.toThrow()
})

it("testingFee", async () => {
  {
    const address = await bitcoindDefaultClient.getNewAddress()
    const fee = await userWallet0.getOnchainFee({ address })
    expect(fee).toBeGreaterThan(0)
  }

  {
    const address = await userWallet3.getOnChainAddress()
    const fee = await userWallet0.getOnchainFee({ address })
    expect(fee).toBe(0)
  }
})

it("throws dust amount error", async () => {
  const address = await bitcoindDefaultClient.getNewAddress()
  expect(
    userWallet0.onChainPay({ address, amount: yamlConfig.onchainDustAmount - 1 }),
  ).rejects.toThrow()
})
