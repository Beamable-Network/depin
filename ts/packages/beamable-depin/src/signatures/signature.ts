import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { address, createSignableMessage, getBase58Decoder, getBase58Encoder, getPublicKeyFromAddress, getUtf8Encoder, type KeyPairSigner, type SignatureBytes, verifySignature } from 'gill'

export const SignatureSchemeSchema = Type.Literal('ed25519')
export type SignatureScheme = Static<typeof SignatureSchemeSchema>

// Base signature without payload
export const BaseSignatureSchema = Type.Object({
    signature: Type.String({ description: 'Base58 signature' }),
    publicKey: Type.String({ description: 'Base58 public key' }),
    scheme: SignatureSchemeSchema,
})

// Signature with payload
export const SignatureWithPayloadSchema = <T extends TSchema>(payloadSchema: T) => Type.Object({
    ...BaseSignatureSchema.properties,
    payload: payloadSchema,
})

export type BaseSignature = Static<typeof BaseSignatureSchema>

// Base signature class for signatures without payload
export class Signature implements BaseSignature {
    public readonly signature: string
    public readonly publicKey: string
    public readonly scheme: SignatureScheme = 'ed25519'

    constructor(data: BaseSignature) {
        this.signature = data.signature;
        this.publicKey = data.publicKey;
        this.scheme = data.scheme;
    }

    async verifyMessage(originalMessage: string): Promise<boolean> {
        try {
            const messageData = getUtf8Encoder().encode(originalMessage);
            const publicKey = await getPublicKeyFromAddress(address(this.publicKey));
            const signatureBytes = getBase58Encoder().encode(this.signature) as SignatureBytes;
            return await verifySignature(publicKey, signatureBytes, messageData);
        } catch (error) {
            return false;
        }
    }
}

export class SignedPayload<T extends TSchema> implements BaseSignature {
    public readonly signature: string
    public readonly publicKey: string
    public readonly scheme: SignatureScheme = 'ed25519'
    public readonly payload: Static<T>

    constructor(data: BaseSignature & { payload: Static<T> }) {
        this.signature = data.signature
        this.publicKey = data.publicKey
        this.payload = data.payload
    }

    static async create<T extends TSchema>(
        payload: Static<T>,
        signer: KeyPairSigner
    ): Promise<SignedPayload<T>> {
        // Serialize payload and create signable message
        const jsonString = JSON.stringify(payload, Object.keys(payload).sort());
        const message = createSignableMessage(jsonString);
        
        // Sign the message
        const [signatures] = await signer.signMessages([message]);
        const signatureBytes = signatures[signer.address];
        
        // Convert signature to Base58
        const signature = getBase58Decoder().decode(signatureBytes);
        
        return new SignedPayload({
            signature,
            publicKey: signer.address,
            scheme: 'ed25519',
            payload
        });
    }

    /**
     * Verify that this signature is valid for the payload and public key
     * @returns Promise<boolean> - true if signature is valid, false otherwise
     */
    async verify(): Promise<boolean> {
        try {
            // Recreate the same message that was signed
            const jsonString = JSON.stringify(this.payload, Object.keys(this.payload).sort());
            const message = createSignableMessage(jsonString);
            const messageData = message.content;
            
            // Get the public key from the address
            const publicKey = await getPublicKeyFromAddress(address(this.publicKey));
            
            // Convert Base58 signature back to bytes
            const signatureBytes = getBase58Encoder().encode(this.signature) as SignatureBytes;
            
            // Verify the signature
            return await verifySignature(publicKey, signatureBytes, messageData);
        } catch (error) {
            // If any step fails, signature is invalid
            return false;
        }
    }
}