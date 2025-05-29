import { memoSharingConfig } from "@config"
import { PartialResult } from "@app/partial-result"

import { LedgerError } from "@domain/ledger"
import { WalletTransactionHistory } from "@domain/wallets"
import { CouldNotFindError } from "@domain/errors"

import { getNonEndUserWalletIds, LedgerService } from "@services/ledger"
import { WalletOnChainPendingReceiveRepository } from "@services/mongoose"
import Ibex from "@services/ibex/client"
import { IbexError } from "@services/ibex/errors"
import { baseLogger } from "@services/logger"
import { GResponse200 } from "ibex-client"
import { ConnectionArguments, ConnectionCursor } from "graphql-relay"

export const getTransactionsForWallets = async ({
  wallets,
  paginationArgs,
}: {
  wallets: Wallet[]
  paginationArgs?: PaginationArgs
}): Promise<PartialResult<PaginatedArray<IbexTransaction>>> => {
  const walletIds = wallets.map((wallet) => wallet.id)
  
  const pagination = convertConnectionArgsToPagination(paginationArgs)
  baseLogger.info({ ...pagination }, "Ibex pagination args")
  // Flash fork: return history from Ibex
  const ibexCalls = await Promise.all(walletIds
    .map(id => Ibex.getAccountTransactions({ 
      account_id: id,
      ...pagination
    }))
  )

  const transactions = ibexCalls.flatMap(resp => {
    if (resp instanceof IbexError) return [] 
    else return toWalletTransactions(resp)
  })

  return PartialResult.ok({
    slice: transactions,
    total: transactions.length
  })
}

export const toWalletTransactions = (ibexResp: GResponse200): IbexTransaction[] => {
  return ibexResp.map(trx => {
    const currency = (trx.currencyId === 3 ? "USD" : "BTC") as WalletCurrency // WalletCurrency: "USD" | "BTC",

    const settlementDisplayPrice: WalletMinorUnitDisplayPrice<WalletCurrency, DisplayCurrency> = {
      base: trx.exchangeRateCurrencySats ? BigInt(Math.floor(trx.exchangeRateCurrencySats)) : 0n,
      offset: 0n, // what is this?
      displayCurrency: "USD" as DisplayCurrency,
      walletCurrency: currency
    }

    const baseTrx: BaseWalletTransaction = {
      walletId: (trx.accountId || "") as WalletId, 
      settlementAmount: toSettlementAmount(trx.amount, trx.transactionTypeId, currency),
      settlementFee: asCurrency(trx.networkFee, currency),
      settlementCurrency: currency, 
      settlementDisplayAmount: `${trx.amount}`, 
      settlementDisplayFee: `${trx.networkFee}`, 
      settlementDisplayPrice: settlementDisplayPrice,
      createdAt: trx.createdAt ? new Date(trx.createdAt) : new Date(), // should always return
      id: trx.id || "null", // "LedgerTransactionId" - this is likely unused 
      status: "success" as TxStatus, // assuming Ibex returns on completed
      memo: null, // query transaction details
    }

    switch (trx.transactionTypeId) {
      case 1:
      case 2:
        return {
          ...baseTrx,
          // Ibex does not provide paymentHash, pubkey and preimage in transactions endpoint. To get these fields,
          // we need to query the transaction details for each trx individually. 
          initiationVia: { type: 'lightning', paymentHash: "", pubkey: "" },
          settlementVia: { type: 'lightning', revealedPreImage: undefined }
        } as WalletLnSettledTransaction
      case 3:
      case 4:
        return {
          ...baseTrx,
          // Ibex does not provide paymentHash, pubkey and preimage in transactions endpoint. To get these fields,
          // we need to query the transaction details for each trx individually. 
          initiationVia: { type: 'onchain', address: "" },
          settlementVia: { type: 'onchain', transactionHash: '', vout: undefined }
        } as WalletOnChainSettledTransaction // assuming Ibex only gives us settled
      default:
        baseLogger.error(`Failed to parse Ibex transaction type. { WalletId: ${baseTrx.walletId}, TransactionId: ${trx.id}, transactionTypeId: ${trx.transactionTypeId}`)
        return { 
          ...baseTrx,
          initiationVia: { type: 'unknown' },
          settlementVia: { type: 'unknown' }
        } as UnknownTypeTransaction
    }
  })
}

const asCurrency = (amount: number | undefined, currency: WalletCurrency): Satoshis | UsdCents => {
  return currency === "USD" ? amount as UsdCents : amount as Satoshis
}

const toSettlementAmount = (
  ibexAmount: number | undefined, 
  transactionTypeId: number | undefined, 
  currency: WalletCurrency
): Satoshis | UsdCents => {
  if (ibexAmount === undefined) {
    baseLogger.warn("Ibex did not return transaction amount")
    return asCurrency(ibexAmount, currency) 
  }
  // When sending, make negative
  const amt = (transactionTypeId === 2 || transactionTypeId === 4) 
    ? -1 * ibexAmount 
    : ibexAmount
  return asCurrency(amt, currency)
}

type IbexPaginationArgs = {
  // sort?: string | undefined; defaults to "settledAt"
  page?: number | undefined;
  limit?: number | undefined;
}

// Helper function to decode cursor (adjust based on your cursor implementation)
function decodeCursor(cursor: ConnectionCursor): { page: number } | null {
  try {
    // This assumes cursor is base64 encoded JSON with page info
    // Adjust this implementation based on your actual cursor format
    const decoded = JSON.parse(atob(cursor));
    return { page: decoded.page || 1 };
  } catch {
    return null;
  }
}

export function convertConnectionArgsToPagination(
  args: ConnectionArguments | undefined
): IbexPaginationArgs {
  const DEFAULTS = {
    page: 0,
    limit: 10,
  }
  if (!args) return DEFAULTS

  const result: IbexPaginationArgs = {};

  // Handle limit (prefer 'first' over 'last')
  if (args.first !== null && args.first !== undefined) {
    result.limit = args.first;
  } else if (args.last !== null && args.last !== undefined) {
    result.limit = args.last;
  }

  // Handle page calculation based on cursors
  if (args.after) {
    const afterInfo = decodeCursor(args.after);
    if (afterInfo) {
      result.page = afterInfo.page + 1;
    }
  } else if (args.before) {
    const beforeInfo = decodeCursor(args.before);
    if (beforeInfo) {
      result.page = Math.max(1, beforeInfo.page - 1);
    }
  }

  if (!result.page) {
    result.page = DEFAULTS.page;
  }

  return result;
}
