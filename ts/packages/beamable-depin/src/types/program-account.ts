import { Address } from "gill";

export interface ProgramAccount<T> {
    address: Address;
    data: T;
}