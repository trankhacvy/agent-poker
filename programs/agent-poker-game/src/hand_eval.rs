pub fn card_value(card: u8) -> u8 {
    card % 13
}

pub fn card_suit(card: u8) -> u8 {
    card / 13
}

pub fn evaluate_hand(cards: &[u8; 7]) -> u32 {
    let mut values = [0u8; 7];
    let mut suits = [0u8; 7];

    for i in 0..7 {
        values[i] = card_value(cards[i]);
        suits[i] = card_suit(cards[i]);
    }

    let mut value_counts = [0u8; 13];
    let mut suit_counts = [0u8; 4];
    for i in 0..7 {
        value_counts[values[i] as usize] += 1;
        suit_counts[suits[i] as usize] += 1;
    }

    let flush_suit = find_flush_suit(&suit_counts);
    let straight_high = find_straight(&value_counts);

    if let Some(fs) = flush_suit {
        let flush_vals: [u8; 7] =
            core::array::from_fn(|i| if suits[i] == fs { values[i] } else { 255 });
        let mut flush_counts = [0u8; 13];
        for &v in &flush_vals {
            if v != 255 {
                flush_counts[v as usize] += 1;
            }
        }
        if let Some(sf_high) = find_straight(&flush_counts) {
            return (9 << 20) | (sf_high as u32);
        }
    }

    if let Some(quad_val) = find_n_of_kind(&value_counts, 4) {
        let kicker = find_best_kicker(&value_counts, quad_val, 1);
        return (8 << 20) | ((quad_val as u32) << 4) | (kicker[0] as u32);
    }

    let trips = find_all_n_of_kind(&value_counts, 3);
    let pairs = find_all_n_of_kind(&value_counts, 2);

    if !trips.is_empty() && (pairs.len() + trips.len()) >= 2 {
        let trip_val = trips[0];
        let pair_val = if trips.len() >= 2 {
            trips[1]
        } else if !pairs.is_empty() {
            pairs[0]
        } else {
            0
        };
        return (7 << 20) | ((trip_val as u32) << 4) | (pair_val as u32);
    }

    if let Some(fs) = flush_suit {
        let mut flush_vals: Vec<u8> = (0..7)
            .filter(|&i| suits[i] == fs)
            .map(|i| values[i])
            .collect();
        flush_vals.sort_unstable_by(|a, b| b.cmp(a));
        let rank = encode_top_5(&flush_vals);
        return (6 << 20) | rank;
    }

    if let Some(high) = straight_high {
        return (5 << 20) | (high as u32);
    }

    if !trips.is_empty() {
        let kickers = find_best_kicker(&value_counts, trips[0], 2);
        return (4 << 20)
            | ((trips[0] as u32) << 8)
            | ((kickers[0] as u32) << 4)
            | (kickers[1] as u32);
    }

    if pairs.len() >= 2 {
        let kicker = find_best_kicker_excluding_2(&value_counts, pairs[0], pairs[1]);
        return (3 << 20) | ((pairs[0] as u32) << 8) | ((pairs[1] as u32) << 4) | (kicker as u32);
    }

    if pairs.len() == 1 {
        let kickers = find_best_kicker(&value_counts, pairs[0], 3);
        return (2 << 20)
            | ((pairs[0] as u32) << 12)
            | ((kickers[0] as u32) << 8)
            | ((kickers[1] as u32) << 4)
            | (kickers[2] as u32);
    }

    let mut sorted: Vec<u8> = values.to_vec();
    sorted.sort_unstable_by(|a, b| b.cmp(a));
    (1 << 20) | encode_top_5(&sorted)
}

fn find_flush_suit(suit_counts: &[u8; 4]) -> Option<u8> {
    suit_counts.iter().position(|&c| c >= 5).map(|i| i as u8)
}

fn find_straight(counts: &[u8; 13]) -> Option<u8> {
    for high in (4u8..13).rev() {
        let all_present = (0..5).all(|offset| counts[(high - offset) as usize] > 0);
        if all_present {
            return Some(high);
        }
    }
    if counts[12] > 0 && counts[0] > 0 && counts[1] > 0 && counts[2] > 0 && counts[3] > 0 {
        return Some(3);
    }
    None
}

fn find_n_of_kind(counts: &[u8; 13], n: u8) -> Option<u8> {
    (0..13u8).rev().find(|&v| counts[v as usize] >= n)
}

fn find_all_n_of_kind(counts: &[u8; 13], n: u8) -> Vec<u8> {
    (0..13u8)
        .rev()
        .filter(|&v| counts[v as usize] == n)
        .collect()
}

fn find_best_kicker(counts: &[u8; 13], exclude: u8, num: usize) -> Vec<u8> {
    let mut kickers: Vec<u8> = (0..13u8)
        .rev()
        .filter(|&v| v != exclude && counts[v as usize] > 0)
        .take(num)
        .collect();
    while kickers.len() < num {
        kickers.push(0);
    }
    kickers
}

fn find_best_kicker_excluding_2(counts: &[u8; 13], ex1: u8, ex2: u8) -> u8 {
    (0..13u8)
        .rev()
        .find(|&v| v != ex1 && v != ex2 && counts[v as usize] > 0)
        .unwrap_or(0)
}

fn encode_top_5(sorted_desc: &[u8]) -> u32 {
    sorted_desc
        .iter()
        .take(5)
        .enumerate()
        .fold(0u32, |acc, (i, &v)| acc | ((v as u32) << (4 * (4 - i))))
}

pub fn evaluate_winner(players: &[(u8, [u8; 2])], community: &[u8; 5]) -> usize {
    let mut best_rank = 0u32;
    let mut best_idx = 0usize;

    for (i, (status, hand)) in players.iter().enumerate() {
        if *status == 0 || *status == 2 {
            continue;
        }

        let mut seven = [0u8; 7];
        seven[0] = hand[0];
        seven[1] = hand[1];
        seven[2] = community[0];
        seven[3] = community[1];
        seven[4] = community[2];
        seven[5] = community[3];
        seven[6] = community[4];

        let rank = evaluate_hand(&seven);
        if rank > best_rank {
            best_rank = rank;
            best_idx = i;
        }
    }

    best_idx
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(value: u8, suit: u8) -> u8 {
        suit * 13 + value
    }

    fn hand_category(rank: u32) -> u32 {
        rank >> 20
    }

    #[test]
    fn test_high_card() {
        // 2h, 5d, 7c, 9s, Jh, 3d, 8c (no pairs, no flush, no straight)
        let cards = [
            card(0, 0),
            card(3, 1),
            card(5, 2),
            card(7, 3),
            card(9, 0),
            card(1, 1),
            card(6, 2),
        ];
        assert_eq!(hand_category(evaluate_hand(&cards)), 1);
    }

    #[test]
    fn test_pair() {
        // Pair of 9s
        let cards = [
            card(7, 0),
            card(7, 1),
            card(3, 2),
            card(5, 3),
            card(9, 0),
            card(1, 1),
            card(0, 2),
        ];
        assert_eq!(hand_category(evaluate_hand(&cards)), 2);
    }

    #[test]
    fn test_two_pair() {
        let cards = [
            card(7, 0),
            card(7, 1),
            card(5, 2),
            card(5, 3),
            card(9, 0),
            card(1, 1),
            card(0, 2),
        ];
        assert_eq!(hand_category(evaluate_hand(&cards)), 3);
    }

    #[test]
    fn test_three_of_a_kind() {
        let cards = [
            card(7, 0),
            card(7, 1),
            card(7, 2),
            card(5, 3),
            card(9, 0),
            card(1, 1),
            card(0, 2),
        ];
        assert_eq!(hand_category(evaluate_hand(&cards)), 4);
    }

    #[test]
    fn test_straight() {
        // 5-6-7-8-9 straight
        let cards = [
            card(3, 0),
            card(4, 1),
            card(5, 2),
            card(6, 3),
            card(7, 0),
            card(0, 1),
            card(1, 2),
        ];
        assert_eq!(hand_category(evaluate_hand(&cards)), 5);
    }

    #[test]
    fn test_ace_low_straight() {
        // A-2-3-4-5 (wheel)
        let cards = [
            card(12, 0),
            card(0, 1),
            card(1, 2),
            card(2, 3),
            card(3, 0),
            card(8, 1),
            card(6, 2),
        ];
        let rank = evaluate_hand(&cards);
        assert_eq!(hand_category(rank), 5);
        assert_eq!(rank & 0xFFFFF, 3); // high card of wheel is 5 (index 3)
    }

    #[test]
    fn test_flush() {
        // 5 hearts, no straight
        let cards = [
            card(0, 0),
            card(2, 0),
            card(5, 0),
            card(7, 0),
            card(9, 0),
            card(1, 1),
            card(3, 2),
        ];
        assert_eq!(hand_category(evaluate_hand(&cards)), 6);
    }

    #[test]
    fn test_full_house() {
        let cards = [
            card(7, 0),
            card(7, 1),
            card(7, 2),
            card(5, 3),
            card(5, 0),
            card(1, 1),
            card(0, 2),
        ];
        assert_eq!(hand_category(evaluate_hand(&cards)), 7);
    }

    #[test]
    fn test_four_of_a_kind() {
        let cards = [
            card(7, 0),
            card(7, 1),
            card(7, 2),
            card(7, 3),
            card(9, 0),
            card(1, 1),
            card(0, 2),
        ];
        assert_eq!(hand_category(evaluate_hand(&cards)), 8);
    }

    #[test]
    fn test_straight_flush() {
        // 5h-6h-7h-8h-9h
        let cards = [
            card(3, 0),
            card(4, 0),
            card(5, 0),
            card(6, 0),
            card(7, 0),
            card(0, 1),
            card(1, 2),
        ];
        assert_eq!(hand_category(evaluate_hand(&cards)), 9);
    }

    #[test]
    fn test_royal_flush() {
        // T-J-Q-K-A of spades
        let cards = [
            card(8, 3),
            card(9, 3),
            card(10, 3),
            card(11, 3),
            card(12, 3),
            card(0, 0),
            card(1, 1),
        ];
        let rank = evaluate_hand(&cards);
        assert_eq!(hand_category(rank), 9);
        assert_eq!(rank & 0xFFFFF, 12); // ace high
    }

    #[test]
    fn test_straight_flush_beats_quads() {
        let sf = [
            card(3, 0),
            card(4, 0),
            card(5, 0),
            card(6, 0),
            card(7, 0),
            card(0, 1),
            card(1, 2),
        ];
        let quads = [
            card(7, 0),
            card(7, 1),
            card(7, 2),
            card(7, 3),
            card(9, 0),
            card(1, 1),
            card(0, 2),
        ];
        assert!(evaluate_hand(&sf) > evaluate_hand(&quads));
    }

    #[test]
    fn test_flush_beats_straight() {
        let flush = [
            card(0, 0),
            card(2, 0),
            card(5, 0),
            card(7, 0),
            card(9, 0),
            card(1, 1),
            card(3, 2),
        ];
        let straight = [
            card(3, 0),
            card(4, 1),
            card(5, 2),
            card(6, 3),
            card(7, 0),
            card(0, 1),
            card(1, 2),
        ];
        assert!(evaluate_hand(&flush) > evaluate_hand(&straight));
    }

    #[test]
    fn test_full_house_beats_flush() {
        let fh = [
            card(7, 0),
            card(7, 1),
            card(7, 2),
            card(5, 3),
            card(5, 0),
            card(1, 1),
            card(0, 2),
        ];
        let flush = [
            card(0, 0),
            card(2, 0),
            card(5, 0),
            card(7, 0),
            card(9, 0),
            card(1, 1),
            card(3, 2),
        ];
        assert!(evaluate_hand(&fh) > evaluate_hand(&flush));
    }

    #[test]
    fn test_pair_kicker_tiebreak() {
        let hand_a = [
            card(7, 0),
            card(7, 1),
            card(11, 2),
            card(5, 3),
            card(3, 0),
            card(1, 1),
            card(0, 2),
        ];
        let hand_b = [
            card(7, 0),
            card(7, 1),
            card(10, 2),
            card(5, 3),
            card(3, 0),
            card(1, 1),
            card(0, 2),
        ];
        assert!(evaluate_hand(&hand_a) > evaluate_hand(&hand_b));
    }

    #[test]
    fn test_evaluate_winner_basic() {
        let community: [u8; 5] = [card(3, 0), card(4, 1), card(5, 2), card(9, 3), card(0, 0)];
        let players: Vec<(u8, [u8; 2])> = vec![
            (1, [card(12, 0), card(11, 1)]), // AK high
            (1, [card(7, 0), card(7, 1)]),   // pair of 9s + board
            (2, [card(0, 1), card(1, 2)]),   // folded
        ];
        assert_eq!(evaluate_winner(&players, &community), 1);
    }

    #[test]
    fn test_evaluate_winner_skips_folded() {
        let community: [u8; 5] = [card(0, 0), card(1, 1), card(2, 2), card(5, 3), card(8, 0)];
        let players: Vec<(u8, [u8; 2])> = vec![
            (2, [card(12, 0), card(12, 1)]), // folded - has aces but shouldn't win
            (1, [card(3, 0), card(5, 1)]),   // active - pair of 7s
        ];
        assert_eq!(evaluate_winner(&players, &community), 1);
    }
}
