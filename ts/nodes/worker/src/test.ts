import { createSignableMessage, generateKeyPairSigner, getBase58Decoder } from "gill";
import { createLogger } from './logger.js';

const logger = createLogger('test');

const signer = await generateKeyPairSigner();
logger.info({ address: signer.address }, "Generated signer");

const now = new Date().getTime();
logger.info({ timestamp: now }, "Data to sign");

const [signature] = (await signer.signMessages([createSignableMessage(now.toString())]));
logger.info({ signature: getBase58Decoder().decode(signature[signer.address]) }, "Signature");