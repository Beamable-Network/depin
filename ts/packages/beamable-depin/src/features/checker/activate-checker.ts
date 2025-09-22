import {
    AccountRole,
    address,
    Address,
    Codec,
    getAddressCodec,
    getStructCodec
} from "gill";

import { AssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { DEPIN_PROGRAM, MPL_ACCOUNT_COMPRESSION_PROGRAM, SYSTEM_PROGRAM_ADDRESS } from "../../constants.js";
import { DepinInstruction } from "../../enums.js";
import { assetToCNftContext, CNftContext, CNftContextCodec } from "../../utils/bubblegum.js";
import { CheckerMetadataAccount } from "./checker-metadata-account.js";

export interface ActivateCheckerParams {
    license_context: CNftContext;
    delegated_to: Address;
}

export const ActivateCheckerParamsCodec: Codec<ActivateCheckerParams> = getStructCodec([
    ["license_context", CNftContextCodec],
    ["delegated_to", getAddressCodec()]
]);

export interface CreateActivateCheckerInput {
    signer: Address;
    checker_license: AssetWithProof;
    delegated_to: Address;
}

export class ActivateChecker {
    signer: Address;
    readonly checker_license: AssetWithProof;
    readonly params: ActivateCheckerParams;

    constructor(input: CreateActivateCheckerInput) {
        this.params = {
            license_context: assetToCNftContext(input.checker_license),
            delegated_to: input.delegated_to,
        };

        this.checker_license = input.checker_license;
        this.signer = input.signer;
    }

    private serialize(): Uint8Array {
        const inner = ActivateCheckerParamsCodec.encode(this.params);
        return Uint8Array.of(DepinInstruction.ActivateChecker, ...inner);
    }

    public async getInstruction() {
        const checkerMetadataPda = await CheckerMetadataAccount.findCheckerMetadataPDA(
            address(this.checker_license.rpcAsset.id),
            address(this.params.license_context.owner)
        );
        
        let accounts = [
            { address: this.signer, role: AccountRole.READONLY_SIGNER },
            { address: checkerMetadataPda[0], role: AccountRole.WRITABLE },
            { address: MPL_ACCOUNT_COMPRESSION_PROGRAM, role: AccountRole.READONLY },
            { address: address(this.checker_license.merkleTree), role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ...this.checker_license.proof.map(proof => ({
                address: address(proof),
                role: AccountRole.READONLY
            }))
        ];
        
        return {
            programAddress: DEPIN_PROGRAM,
            accounts: accounts,
            data: this.serialize(),
        };
    }
}