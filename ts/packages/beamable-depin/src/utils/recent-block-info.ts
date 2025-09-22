import { Blockhash } from "gill";

export type RecentBlockInfo = Readonly<{
    blockhash: Blockhash;
    lastValidBlockHeight: bigint;
}>;