// @flow
import type {
  Transaction,
  CoreCosmosLikeTransaction,
  CoreCosmosGasLimitRequest,
} from "./types";
import type { Account } from "../../types";
import type { Core, CoreAccount, CoreCurrency } from "../../libcore/types";

import {
  bigNumberToLibcoreAmount,
  libcoreBigIntToBigNumber,
} from "../../libcore/buildBigNumber";
import { BigNumber } from "bignumber.js";
import { cosmosCreateMessage } from "./message";
import { getEnv } from "../../env";
import { promiseAllBatched } from "../../promise";
import { getMaxEstimatedBalance } from "./utils";

export async function cosmosBuildTransaction({
  account,
  core,
  coreAccount,
  coreCurrency,
  transaction,
  isCancelled,
}: {
  account: Account,
  core: Core,
  coreAccount: CoreAccount,
  coreCurrency: CoreCurrency,
  transaction: Transaction,
  isPartial: boolean,
  isCancelled: () => boolean,
}): Promise<?CoreCosmosLikeTransaction> {
  const { fees, gasLimit, memo } = transaction;

  const cosmosLikeAccount = await coreAccount.asCosmosLikeAccount();
  if (isCancelled()) return;

  const transactionBuilder = await cosmosLikeAccount.buildTransaction();
  if (isCancelled()) return;

  let messages = await cosmosCreateMessage(
    account.freshAddress,
    {
      ...transaction,
      amount: transaction.useAllAmount
        ? getMaxEstimatedBalance(account, transaction, BigNumber(0))
        : transaction.amount,
    },
    core
  );

  const memoTransaction = memo || "";
  await transactionBuilder.setMemo(memoTransaction);

  // Gas
  let gas: BigNumber;

  if (gasLimit && gasLimit !== "0") {
    gas = BigNumber(gasLimit);
  } else {
    const gasRequest: CoreCosmosGasLimitRequest = {
      memo: memoTransaction,
      amplifier: getEnv("COSMOS_GAS_AMPLIFIER"),
      messages,
    };
    gas = await libcoreBigIntToBigNumber(
      await cosmosLikeAccount.estimateGas(gasRequest)
    );
  }
  const gasAmount = await bigNumberToLibcoreAmount(core, coreCurrency, gas);
  if (isCancelled()) return;

  await transactionBuilder.setGas(gasAmount);

  const gasPrice = getEnv("COSMOS_GAS_PRICE");

  const feesBigNumber = gas
    .multipliedBy(gasPrice)
    .integerValue(BigNumber.ROUND_CEIL);

  const feesAmount = await bigNumberToLibcoreAmount(
    core,
    coreCurrency,
    fees || feesBigNumber
  );
  if (isCancelled()) return;
  await transactionBuilder.setFee(feesAmount);

  if (transaction.useAllAmount && transaction.amount) {
    messages = await cosmosCreateMessage(
      account.freshAddress,
      {
        ...transaction,
        amount: getMaxEstimatedBalance(account, transaction, feesBigNumber),
      },
      core
    );
  }

  promiseAllBatched(
    3,
    messages,
    async (message) => await transactionBuilder.addMessage(message)
  );

  // Signature information
  const seq = await cosmosLikeAccount.getSequence();
  const accNum = await cosmosLikeAccount.getAccountNumber();

  await transactionBuilder.setAccountNumber(accNum);
  await transactionBuilder.setSequence(seq);

  return await transactionBuilder.build();
}

export default cosmosBuildTransaction;
