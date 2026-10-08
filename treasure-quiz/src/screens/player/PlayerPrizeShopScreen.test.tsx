import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PlayerPrizeShopScreen from './PlayerPrizeShopScreen';

afterEach(() => cleanup());

const chests = [
  { key: 'copper', name: 'ทองแดง', goldCost: 100, gemCost: 0 },
  { key: 'crystal', name: 'คริสตัล', goldCost: 0, gemCost: 1 },
];

it('updates remaining resources and only enables confirm at zero', () => {
  const action = vi.fn().mockResolvedValue({ ok: true });
  render(<PlayerPrizeShopScreen gameId="game-1" gold={200} gems={1} chests={chests} action={action} />);
  expect(screen.getByText('เหลือ 200 ทอง')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /เพิ่ม ทองแดง/i }));
  expect(screen.getByText('เหลือ 100 ทอง')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /ยืนยันการเปิดหีบ/i })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /เพิ่ม ทองแดง/i }));
  fireEvent.click(screen.getByRole('button', { name: /เพิ่ม คริสตัล/i }));
  expect(screen.getByText('เหลือ 0 ทอง')).toBeInTheDocument();
  expect(screen.getByText('เหลือ 0 เพชร')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /ยืนยันการเปิดหีบ/i })).toBeEnabled();
});

it('applies a server completion suggestion', () => {
  render(<PlayerPrizeShopScreen gameId="game-1" gold={100} gems={0} chests={chests} action={vi.fn()} suggestion={{ key: 'copper', quantity: 1 }} />);
  fireEvent.click(screen.getByRole('button', { name: /เติมให้หมด/i }));
  expect(screen.getByText('เหลือ 0 ทอง')).toBeInTheDocument();
});
