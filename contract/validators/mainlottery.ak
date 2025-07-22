use cardano/transaction.{OutputReference, Transaction, InlineDatum, Output}
use aiken/collection/list

// Helper functions for working with lists of tuples using aiken/collection/list
fn get_value(list_: List<(ByteArray, Int)>, key: ByteArray) -> Option<Int> {
  when list_ is {
    [] -> None
    [(k, v), ..xs] -> if k == key { Some(v) } else { get_value(xs, key) }
  }
}

fn get_splits(list_: List<(ByteArray, List<Int>)>, key: ByteArray) -> Option<List<Int>> {
  when list_ is {
    [] -> None
    [(k, splits), ..xs] -> if k == key { Some(splits) } else { get_splits(xs, key) }
  }
}

// Helper function to check if a ByteArray is in a List<ByteArray>
fn any_bytearray(list_: List<ByteArray>, value: ByteArray) -> Bool {
  when list_ is {
    [] -> False
    [x, ..xs] -> if x == value { True } else { any_bytearray(xs, value) }
  }
}

// Minimal lottery state datum for simple ADA lottery
pub type LotteryStateDatum {
  total_pools: List<(ByteArray, Int)>,           // Multi-token pools (policy_id, amount)
  ticket_prices: List<(ByteArray, Int)>,         // Dynamic pricing per token (policy_id, price)
  total_tickets: Int,                            // For weighted odds
  accepted_tokens: List<ByteArray>,              // List of accepted token policy IDs
  prize_split: List<(ByteArray, List<Int>)>      // Configurable prize distribution (policy_id, splits)
}

// Minimal redeemer types for lottery operations
pub type LotteryRedeemer {
  Initialize {
    ticket_prices: List<(ByteArray, Int)>,
    accepted_tokens: List<ByteArray>,
    prize_split: List<(ByteArray, List<Int>)>
  }
  BuyTicket { 
    payment: Int,           // Payment amount
    policy_id: ByteArray,   // Token policy ID
    ticket_count: Int       // Number of tickets
  }
  ClaimPrizes {
    winner_indices: List<Int>,
    prize_amounts: List<(ByteArray, List<Int>)>
  }
  RolloverJackpot {}
  UpdateDatum {
    new_ticket_prices: List<(ByteArray, Int)>,
    new_accepted_tokens: List<ByteArray>,
    new_prize_split: List<(ByteArray, List<Int>)>
  }
}

validator lottery {
  spend(
    datum_opt: Option<LotteryStateDatum>,
    redeemer: LotteryRedeemer,
    _input: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt
    when redeemer is {
      Initialize { ticket_prices, accepted_tokens, prize_split } ->
        // Only allow initialization if all tokens/prices/splits are valid
        list.all(ticket_prices, fn((_k, v)) { v > 0 }) &&
        list.length(accepted_tokens) > 0 &&
        list.length(list.unique(accepted_tokens)) == list.length(accepted_tokens) &&
        list.all(accepted_tokens, fn(token) { 
          contains_key(ticket_prices, token) && contains_splits_key(prize_split, token) 
        }) &&
        list.all(prize_split, fn((_k, percentages)) {
          list.length(percentages) > 0 &&
          list.all(percentages, fn(p) { p > 0 }) &&
          list.foldl(percentages, 0, fn(sum, p) { sum + p }) == 100
        }) &&
        validate_script_output_present(tx)
      BuyTicket { payment, policy_id, ticket_count } ->
        validate_buy_ticket(datum, payment, policy_id, ticket_count, tx)
      ClaimPrizes { winner_indices, prize_amounts } ->
        // Distribute prizes after draw
        list.length(winner_indices) > 0 &&
        list.length(list.unique(winner_indices)) == list.length(winner_indices) &&
        list.all(winner_indices, fn(i) { i >= 0 && i < datum.total_tickets }) &&
        list.all(datum.accepted_tokens, fn(policy_id) {
          let total_pool = when get_value(datum.total_pools, policy_id) is {
            Some(value) -> value
            None -> 0
          }
          let percentages = when get_splits(datum.prize_split, policy_id) is {
            Some(splits) -> splits
            None -> []
          }
          let prize_amounts_for_token = when get_splits(prize_amounts, policy_id) is {
            Some(amounts) -> amounts
            None -> []
          }
          let prize_sum = list.foldl(prize_amounts_for_token, 0, fn(sum, amount) { sum + amount })
          list.length(winner_indices) == list.length(percentages) &&
          list.length(prize_amounts_for_token) == list.length(percentages) &&
          prize_sum == total_pool
        }) &&
        validate_script_output_present(tx)
      RolloverJackpot {} ->
        // Only allow rollover if there are no winners (e.g., total_tickets == 0)
        datum.total_tickets == 0 && validate_script_output_present(tx)
      UpdateDatum { new_ticket_prices, new_accepted_tokens, new_prize_split } ->
        // Allow updating datum if new values are valid
        list.all(new_ticket_prices, fn((_k, v)) { v > 0 }) &&
        list.length(new_accepted_tokens) > 0 &&
        list.length(list.unique(new_accepted_tokens)) == list.length(new_accepted_tokens) &&
        list.all(new_accepted_tokens, fn(token) {
          contains_key(new_ticket_prices, token) && contains_splits_key(new_prize_split, token)
        }) &&
        list.all(new_prize_split, fn((_k, percentages)) {
          list.length(percentages) > 0 &&
          list.all(percentages, fn(p) { p > 0 }) &&
          list.foldl(percentages, 0, fn(sum, p) { sum + p }) == 100
        }) &&
        validate_script_output_present(tx)
    }
  }
  else(_) {
    fail
  }
}

// Helper function to check if a key exists in a List<(ByteArray, Int)>
fn contains_key(list_: List<(ByteArray, Int)>, key: ByteArray) -> Bool {
  when list_ is {
    [] -> False
    [(k, _), ..xs] -> if k == key { True } else { contains_key(xs, key) }
  }
}

// Helper function to check if a key exists in a List<(ByteArray, List<Int>)>
fn contains_splits_key(list_: List<(ByteArray, List<Int>)>, key: ByteArray) -> Bool {
  when list_ is {
    [] -> False
    [(k, _), ..xs] -> if k == key { True } else { contains_splits_key(xs, key) }
  }
}

// Helper function to validate BuyTicket logic
fn validate_buy_ticket(
  datum: LotteryStateDatum,
  payment: Int,
  policy_id: ByteArray,
  ticket_count: Int,
  tx: Transaction
) -> Bool {
  let ticket_price = when get_value(datum.ticket_prices, policy_id) is {
    Some(value) -> value
    None -> 0
  }
  any_bytearray(datum.accepted_tokens, policy_id) &&
  ticket_count > 0 &&
  payment == ticket_count * ticket_price &&
  validate_script_output_present(tx)
}

// Helper function to validate that there's at least one script output with inline datum
fn validate_script_output_present(tx: Transaction) -> Bool {
  validate_outputs_for_inline_datum(tx.outputs)
}

fn validate_outputs_for_inline_datum(outputs: List<Output>) -> Bool {
  when outputs is {
    [] -> False
    [output, ..xs] -> when output.datum is {
      InlineDatum(_data) -> True
      _ -> validate_outputs_for_inline_datum(xs)
    }
  }
}