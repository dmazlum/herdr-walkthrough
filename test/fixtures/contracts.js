export const files = [
  { path: 'migrations/20261101_orders.sql', aliases: ['h1'] },
  { path: 'proto/orders.proto', aliases: ['h2'] },
  { path: 'src/api/orders.ts', aliases: ['h3'] },
];
export const ids = { h1: 'sql-hunk', h2: 'proto-hunk', h3: 'api-hunk' };
export const contractFixtures = [
  {
    kind: 'database', title: 'Status zamówienia staje się wymagany',
    summary: 'Migracja uzupełnia puste statusy i dodaje ograniczenie NOT NULL.', compatibility: 'mixed',
    impact: 'Po migracji zapis NULL jest odrzucany. Domyślny status nie naprawia jawnego NULL wysyłanego przez starszy kod.',
    changes: [{ name: 'orders.status', operation: 'modified', before: 'status text NULL', after: "status text NOT NULL\nDEFAULT 'pending'", detail: 'Backfill ustawia pending dla istniejących pustych statusów. Nowy domyślny status dotyczy zapisów pomijających pole.', hunks: ['h1'] }],
    rollout: ['Najpierw wykonywany jest UPDATE pustych statusów pokazany w migracji.', 'Po backfillu migracja ustawia DEFAULT i NOT NULL.'],
  },
  {
    kind: 'protobuf', title: 'Identyfikator zamówienia zmienia typ',
    summary: 'Pole id w komunikacie Order przechodzi z int64 na string.', compatibility: 'breaking',
    impact: 'Ten sam numer pola 1 zmienia typ kodowania z varint na length-delimited. Stare i nowe klienty nie odczytają tej wartości tak samo.',
    changes: [{ name: 'Order.id = 1', operation: 'modified', before: 'int64 id = 1;', after: 'string id = 1;', detail: 'Zmieniony kontrakt wymaga aktualizacji wygenerowanego kodu. Kolejność publikacji klientów nie jest pokazana w diffie.', hunks: ['h2'] }], rollout: [],
  },
  {
    kind: 'api', title: 'Tworzenie zamówienia wymaga customerId',
    summary: 'Endpoint POST /orders odrzuca żądania bez identyfikatora klienta.', compatibility: 'breaking',
    impact: 'Starszy klient pomijający customerId otrzyma 400 zamiast utworzonego zamówienia. Aktualizacja dotyczy kontraktu żądania.',
    changes: [{ name: 'POST /orders · request.customerId', operation: 'modified', before: 'customerId?: string\nBrak pola: 201 Created', after: 'customerId: string\nBrak pola: 400 Bad Request', detail: 'Walidacja wymaga niepustego identyfikatora. Motywacja biznesowa nie została podana w diffie.', hunks: ['h3'] }], rollout: [],
  },
];
