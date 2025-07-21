# UpdateDatum Redeemer Guide

## What is the UpdateDatum Redeemer?
The `UpdateDatum` redeemer allows you to update the on-chain configuration (datum) of your Cardano smart contract without redeploying a new contract. You can change ticket prices, accepted tokens, prize splits, and more by submitting a transaction that spends the current contract UTxO and creates a new one with the updated datum.

---

## How Does It Work?
- The contract enforces that only valid updates are allowed (e.g., prize splits sum to 100, tokens are unique, etc.).
- You must build a transaction that:
  1. Spends the current contract UTxO (removes the old datum)
  2. Creates a new UTxO at the contract address with the new datum
  3. Uses the `UpdateDatum` redeemer

---

## Example: Updating the Datum

### 1. Edit Your Datum File
- Open your datum file (e.g., `init_datum.plutus.json`)
- Change the configuration you want (e.g., add a new token, change ticket price, update prize split)

**Example: Change ticket price to 10 ADA (10,000,000 lovelace):**
```json
{
  ...
  "fields": [
    ...
    { "list": [ { "list": [ { "bytes": "" }, { "int": 10000000 } ] } ] },
    ...
  ]
}
```

### 2. Find the Current Contract UTxO
```bash
./cardano-cli-x86_64-linux query utxo --address <CONTRACT_ADDRESS> --testnet-magic 2 --socket-path ~/cardano/preview/node.socket
```
- Note the UTxO hash and index (e.g., `abcd...#0`)

### 3. Build the Update Transaction
```bash
./cardano-cli-x86_64-linux conway transaction build \
  --testnet-magic 2 \
  --tx-in <CURRENT_UTXO> \
  --tx-in-collateral <ADMIN_UTXO> \
  --tx-out "<CONTRACT_ADDRESS>+<AMOUNT>" \
  --tx-out-inline-datum-file <UPDATED_DATUM_FILE> \
  --change-address <ADMIN_ADDRESS> \
  --required-signer-hash <ADMIN_KEY_HASH> \
  --out-file tx.raw \
  --cardano-mode \
  --socket-path ~/cardano/preview/node.socket
```

### 4. Sign the Transaction
```bash
./cardano-cli-x86_64-linux conway transaction sign \
  --tx-body-file tx.raw \
  --signing-key-file <ADMIN_SKEY> \
  --testnet-magic 2 \
  --out-file tx.signed
```

### 5. Submit the Transaction
```bash
./cardano-cli-x86_64-linux conway transaction submit \
  --tx-file tx.signed \
  --testnet-magic 2 \
  --socket-path ~/cardano/preview/node.socket
```

### 6. Verify the Update
```bash
./cardano-cli-x86_64-linux query utxo --address <CONTRACT_ADDRESS> --testnet-magic 2 --socket-path ~/cardano/preview/node.socket
```

---

## Notes
- Only one datum is active at a time; the old datum is replaced on-chain.
- You can update ticket prices, accepted tokens, prize splits, and more.
- The backend can automate this process, but the update must be submitted on-chain.

---

**For more details, see your contract source or ask your dev team!** 

---

A real example from the command used to submit the update on-chain

1. Build the Update Transaction

./initialize_contract/cardano-cli-x86_64-linux conway transaction build \
  --testnet-magic 2 \
  --tx-in 078b43d4db1b3f1c24c42b63d2ece913a7237c0ee7d0aebb6b80bc019a816369#0 \
  --tx-in-collateral 078b43d4db1b3f1c24c42b63d2ece913a7237c0ee7d0aebb6b80bc019a816369#0 \
  --tx-out "addr_test1wqphj86rnmxlzz9ntyrsu6rdk3ylpqsr492p3gz7wampp7cdsux3s+13000000" \
  --tx-out-inline-datum-file initialize_contract/initialize_contract/init_datum.plutus.json \
  --change-address addr_test1vp6jucpj0sdclz4trdnzvtqs6x3e7vaq8psauzhcl0jd0vc3qnet5 \
  --required-signer-hash 752e60327c1b8f8aab1b66262c10d1a39f33a03861de0af8fbe4d7b3 \
  --out-file tx.raw \
  --cardano-mode \
  --socket-path ~/cardano/preview/node.socket

////terminal log reponse////

van@Study-PC:~/official-mainnet-nplottery$ ./initialize_contract/cardano-cli-x86_64-linux conway transaction
 build \
>   --testnet-magic 2 \
>   --tx-in 078b43d4db1b3f1c24c42b63d2ece913a7237c0ee7d0aebb6b80bc019a816369#0 \
>   --tx-in-collateral 078b43d4db1b3f1c24c42b63d2ece913a7237c0ee7d0aebb6b80bc019a816369#0 \
>   --tx-out "addr_test1wqphj86rnmxlzz9ntyrsu6rdk3ylpqsr492p3gz7wampp7cdsux3s+13000000" \
>   --tx-out-inline-datum-file initialize_contract/initialize_contract/init_datum.plutus.json \
>   --change-address addr_test1vp6jucpj0sdclz4trdnzvtqs6x3e7vaq8psauzhcl0jd0vc3qnet5 \
>   --required-signer-hash 752e60327c1b8f8aab1b66262c10d1a39f33a03861de0af8fbe4d7b3 \
>   --out-file tx.raw \
>   --cardano-mode \
>   --socket-path ~/cardano/preview/node.socket
Estimated transaction fee: 186401 Lovelace
van@Study-PC:~/official-mainnet-nplottery$


2. Sign the Transaction

./initialize_contract/cardano-cli-x86_64-linux conway transaction sign --tx-body-file tx.raw --signing-key-file initialize_contract/admin.skey --testnet-magic 2 --out-file tx.signed

////terminal log reponse////

van@Study-PC:~/official-mainnet-nplottery$ ./initialize_contract/cardano-cli-x86_64-linux conway transaction
 sign --tx-body-file tx.raw --signing-key-file initialize_contract/admin.skey --testnet-magic 2 --out-file t
x.signed
van@Study-PC:~/


3.Submit the Transaction

./initialize_contract/cardano-cli-x86_64-linux conway transaction submit --tx-file tx.signed --testnet-magic 2 --socket-path ~/cardano/preview/node.socket

////terminal log reponse////

van@Study-PC:~/official-mainnet-nplottery$ ./initialize_contract/cardano-cli-x86_64-linux conway transaction
 submit --tx-file tx.signed --testnet-magic 2 --socket-path ~/cardano/preview/node.socket
Transaction successfully submitted. Transaction hash is:
{"txhash":"7490bdee9afbaa01552325a9df25e4a7b0ffa3efb484a3ddda3476249bb68729"}


4. Verify the Update

./initialize_contract/cardano-cli-x86_64-linux query utxo --address addr_test1wqphj86rnmxlzz9ntyrsu6rdk3ylpqsr492p3gz7wampp7cdsux3s --testnet-magic 2 --socket-path ~/cardano/preview/node.socket

////terminal log reponse////

van@Study-PC:~/official-mainnet-nplottery$ ./initialize_contract/cardano-cli-x86_64-linux query utxo --address addr_test1wqphj86rnmxlzz9ntyrsu6rdk3ylpqsr492p3gz7wampp7cdsux3s --testnet-magic 2 --socket-path ~/cardano/preview/node.socket

The transaction was successfully submitted (tx hash:
7490bdee9afbaa01552325a9df25e4a7b0ffa3efb484a3ddda3476249bb68729),
but the UTxO query at the contract address returned {} (empty).

What this means:
The transaction was accepted by the network, but the UTxO may not be visible yet due to:
Node lag (wait a minute and try again)
The transaction is still being processed
The output was not created as expected (possible datum or script mismatch)
Queried the contract address for UTxOs immediately after submission.
The result was {} (empty), which is common if the transaction is still being processed or the node is catching up.

What You Did
Built the initialization transaction with the correct Plutus-compatible datum.
Signed the transaction with your admin key.
Submitted the transaction to the Cardano preview testnet.
The transaction was accepted and a transaction hash was returned:
7490bdee9afbaa01552325a9df25e4a7b0ffa3efb484a3ddda3476249bb68729

What Happened Next
After waiting a minute or two, you re-ran the UTxO query and received a result showing the new UTxO at your contract address, with the correct inline datum and 13 ADA locked at the script address.
This means:

The contract initialization transaction was successful.
The datum is now live on-chain at your contract address.
Your dApp is ready for user interactions (buying tickets, etc.) on the preview testnet!

What to Do Next
You can now test the full dApp flow (buy tickets, claim prizes, update datum, etc.).
If you want to update the datum in the future, follow the process in your new readme.dm using the UpdateDatum redeemer.




/////


1. Which file do I update for changing the datum?

/home/van/official-mainnet-nplottery/initialize_contract/init_datum.plutus.json
Edit this file to reflect your new configuration (ticket prices, accepted tokens, prize split, etc.).
Then, use it in your update transaction with the UpdateDatum redeemer.

2. Do you need to update the frontend and backend with the new UTxO/datum?

Backend
No, you do not need to update the backend with the new datum file directly.
The backend should always query the current on-chain datum at the contract address using Blockfrost or your node.
As long as your backend is configured with the correct contract script address, it will always fetch the latest datum from the blockchain.

Frontend
No, you do not need to update the frontend with the new datum file directly.
The frontend should rely on the backend (or directly on-chain via Lucid/Blockfrost) to get the current contract state.
As long as the frontend is using the correct contract address and backend API, it will always reflect the latest on-chain datum.

3. Is everything set up correctly?

Backend
Your backend is set up to use the contract address from your .env file.
It queries the current datum from the blockchain (via Blockfrost or node).
No manual update is needed after a datum change—just ensure the contract address is correct.

Frontend
Your frontend is set up to use the correct contract address and backend API.
It gets contract state via backend endpoints or directly from the blockchain.
No manual update is needed after a datum change—just ensure the contract address is correct.

Summary Table
What you want to change	What to update	Do you need to update frontend/backend?
Datum (on-chain state)	init_datum.plutus.json	No, as long as contract address is correct

Contract address	.env, frontend config files	Yes, update everywhere