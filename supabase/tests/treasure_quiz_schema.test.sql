begin;

select plan(20);

select has_table('public', 'tq_player_profile');
select has_table('public', 'tq_questions');
select has_table('public', 'tq_games');
select has_table('public', 'tq_rounds');
select has_table('public', 'tq_answers');
select has_table('public', 'tq_chest_types');
select has_table('public', 'tq_chest_opens');
select has_table('public', 'tq_wallet_entries');
select has_table('public', 'tq_reward_catalog');
select has_table('public', 'tq_redemptions');

select has_type('public', 'tq_game_phase');
select has_type('public', 'tq_bet_type');
select has_type('public', 'tq_question_type');
select has_type('public', 'tq_redemption_status');

select has_column('public', 'tq_player_profile', 'balance_satang');
select has_column('public', 'tq_games', 'gold');
select has_column('public', 'tq_games', 'gems');
select has_column('public', 'tq_questions', 'correct_answer');
select has_column('public', 'tq_chest_types', 'reward_table');
select has_column('public', 'tq_wallet_entries', 'idempotency_key');

select finish();
rollback;
