import { createKeyPairSignerFromPrivateKeyBytes } from "gill";
import { KeyPairSigner } from "@solana/signers";
import * as readline from 'readline';


export async function askForSecretKey(prompt: string): Promise<KeyPairSigner> {
    const answer = await askForInput(`Enter secret key for "${prompt}" as JSON array (e.g., [1,2,3,...]): `);
    const secretKeyArray = JSON.parse(answer) as number[];
    const secretKey = new Uint8Array(secretKeyArray);    
    const signer = await createKeyPairSignerFromPrivateKeyBytes(secretKey);
    return signer;
}


export function askForInput(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(`${question}: `, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}
