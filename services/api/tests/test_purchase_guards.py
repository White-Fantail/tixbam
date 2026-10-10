"""Sale/provider-independent claims, migration debt, and PostgreSQL worker races."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import Session

from app.db import Base
from app.models import (Artist, Event, Performance, Provider, PurchaseGuard,
                        PurchaseIntentLease, TicketSale, User, UserBookingPlan, now)
from app.booking_leases import Acquire, LeaseOperation, acquire, claim, reconciliation_status
from app.migrations import migrate_purchase_guards


@pytest.fixture
def engine(tmp_path):
    value = create_engine('sqlite:///' + str(tmp_path / 'guards.db'))
    Base.metadata.create_all(value)
    yield value
    value.dispose()


def seed(engine, second_provider='other-seller'):
    ids = {k: str(uuid4()) for k in ('user', 'artist', 'event', 'performance', 'other',
                                     'sale1', 'sale2', 'plan1', 'plan2', 'plan3')}
    ids['second_provider'] = second_provider
    with Session(engine) as db:
        db.add_all([User(id=ids['user'], display_name='Offline owner'),
                    Artist(id=ids['artist'], name='Offline Artist'),
                    Provider(id='cityline', name='Cityline', url='https://cityline.com.hk'),
                    Provider(id='other-seller', name='Other', url='https://example.test')])
        db.flush()
        db.add(Event(id=ids['event'], artist_id=ids['artist'], title='Offline Show'))
        db.flush()
        db.add_all([Performance(id=ids['performance'], event_id=ids['event'], session_key='one'),
                    Performance(id=ids['other'], event_id=ids['event'], session_key='two'),
                    TicketSale(id=ids['sale1'], provider_id='cityline', event_id=ids['event'],
                               booking_url='https://cityline.com.hk', applies_to_all=True),
                    TicketSale(id=ids['sale2'], provider_id=second_provider, event_id=ids['event'],
                               booking_url='https://example.test', applies_to_all=True)])
        db.flush()
        for plan, provider, sale, perf in [('plan1', 'cityline', 'sale1', 'performance'),
                                         ('plan2', second_provider, 'sale2', 'performance'),
                                         ('plan3', 'cityline', 'sale1', 'other')]:
            db.add(UserBookingPlan(user_id=ids['user'], id=ids[plan], payload={
                'providerId': provider, 'saleId': ids[sale], 'performanceId': ids[perf]}))
        db.commit()
    return ids


def reserve(engine, ids, second=False, other=False):
    owner = str(uuid4())
    with Session(engine) as db:
        body = Acquire(planId=ids['plan3' if other else 'plan2' if second else 'plan1'],
                       providerId=ids['second_provider'] if second else 'cityline',
                       saleId=ids['sale2' if second else 'sale1'],
                       performanceId=ids['other' if other else 'performance'], ownerId=owner)
        result = acquire(body, db.get(User, ids['user']), db)
    return LeaseOperation(leaseId=result['leaseId'], ownerId=owner,
                          fencingToken=result['fencingToken'], leaseToken=result['leaseToken'])


def submit_claim(engine, ids, op):
    with Session(engine) as db:
        return claim(op, db.get(User, ids['user']), db)


@pytest.mark.parametrize('second_provider', ['cityline', 'other-seller'])
def test_cross_seller_claim_blocks_existing_lease_and_new_acquire_but_other_session_is_independent(engine, second_provider):
    ids = seed(engine, second_provider)
    one, two = reserve(engine, ids), reserve(engine, ids, second=True)
    first = submit_claim(engine, ids, one)
    assert first['purchaseScopeVersion'] == 2
    assert first['guardStatus'] == 'claimed'
    assert first['guardId'] and first['claimId']
    with pytest.raises(HTTPException) as failure:
        submit_claim(engine, ids, two)
    assert failure.value.status_code == 409
    with pytest.raises(HTTPException):
        reserve(engine, ids, second=True)
    assert submit_claim(engine, ids, reserve(engine, ids, other=True))['status'] == 'claimed'
    with Session(engine) as db:
        assert len(db.scalars(select(PurchaseGuard)).all()) == 2
        assert db.get(PurchaseIntentLease, str(two.leaseId)).status == 'leased'
        info = reconciliation_status(two.leaseId, db.get(User, ids['user']), db)
        assert info['purchaseBlocked'] and info['requiresManualReview']
        assert info['guardId'] == first['guardId']


def test_invalid_fence_rolls_back_guard_and_current_plan_is_revalidated(engine):
    ids = seed(engine)
    one = reserve(engine, ids)
    with pytest.raises(HTTPException):
        submit_claim(engine, ids, one.model_copy(update={'fencingToken': 2}))
    with Session(engine) as db:
        assert db.scalar(select(PurchaseGuard)) is None
        p = db.get(UserBookingPlan, (ids['user'], ids['plan1']))
        p.payload = {**p.payload, 'performanceId': ids['other']}
        db.commit()
    with pytest.raises(HTTPException):
        submit_claim(engine, ids, one)
    with Session(engine) as db:
        assert db.scalar(select(PurchaseGuard)) is None
        p = db.get(UserBookingPlan, (ids['user'], ids['plan1']))
        p.payload = {**p.payload, 'performanceId': ids['performance']}
        db.commit()
    assert submit_claim(engine, ids, one)['status'] == 'claimed'


def test_legacy_claim_backfill_is_idempotent_preserves_conflicts_and_orphan_debt(engine):
    ids = seed(engine)
    one, two = reserve(engine, ids), reserve(engine, ids, second=True)
    with Session(engine) as db:
        for op in (one, two):
            row = db.get(PurchaseIntentLease, str(op.leaseId))
            row.status = 'claimed'
            row.claimed_at = now()
        db.commit()
    # Legacy rows already deny acquisition, even before startup backfill runs.
    with pytest.raises(HTTPException):
        reserve(engine, ids, second=True)
    migrate_purchase_guards(engine)
    with Session(engine) as db:
        guard = db.scalar(select(PurchaseGuard))
        original = (guard.id, guard.claim_id)
        assert guard.status == 'review_required'
    migrate_purchase_guards(engine)
    with Session(engine) as db:
        guard = db.scalar(select(PurchaseGuard))
        assert (guard.id, guard.claim_id) == original
        assert len(db.scalars(select(PurchaseIntentLease)).all()) == 2
        # Historical dangling target is retained, not dropped as irrelevant.
        db.add(PurchaseIntentLease(user_id=ids['user'], provider_id='cityline',
            sale_id=str(uuid4()), performance_id=str(uuid4()), plan_id=str(uuid4()),
            owner_hash='0'*64, token_hash='1'*64, status='claimed', expires_at=now()))
        db.commit()
    with pytest.raises(HTTPException) as failure:
        reserve(engine, ids, other=True)
    assert 'LEGACY_SCOPE_UNRESOLVED' in failure.value.detail


def test_guarded_performance_cannot_be_deleted(engine):
    from app.admin import delete_performance
    ids = seed(engine)
    submit_claim(engine, ids, reserve(engine, ids))
    with Session(engine) as db, pytest.raises(HTTPException) as failure:
        delete_performance(ids['performance'], db)
    assert failure.value.status_code == 409
    assert 'purchase safety records' in failure.value.detail


def test_postgres_competing_workers_commit_exactly_one_guard():
    url = os.environ.get('TIXBAM_TEST_POSTGRES_URL')
    if not url:
        pytest.skip('Dedicated local/CI PostgreSQL required for transaction race')
    # Isolated generated schema; never modify production/public catalog tables.
    schema = 'guard_test_' + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    pg = create_engine(url, connect_args={'options': f'-csearch_path={schema}'})
    try:
        Base.metadata.create_all(pg)
        ids = seed(pg)
        ops = [reserve(pg, ids), reserve(pg, ids, second=True)]
        barrier = Barrier(2)
        def worker(op):
            with Session(pg) as db:
                user = db.get(User, ids['user'])
                # Both workers pass the read check before either INSERT. This
                # forces the database UNIQUE lock, not a Python mutex, to decide.
                def synchronize(session, *_):
                    if any(isinstance(x, PurchaseGuard) for x in session.new):
                        barrier.wait(timeout=10)
                event.listen(db, 'before_flush', synchronize)
                try:
                    result = claim(op, user, db)
                    return result['status']
                except HTTPException as exc:
                    assert exc.status_code == 409
                    return 'blocked'
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(worker, ops))
        assert sorted(results) == ['blocked', 'claimed']
        with Session(pg) as db:
            assert len(db.scalars(select(PurchaseGuard)).all()) == 1
            statuses = [x.status for x in db.scalars(select(PurchaseIntentLease)).all()]
            assert sorted(statuses) == ['claimed', 'leased']
        migrate_purchase_guards(pg)
        with pytest.raises(HTTPException):
            submit_claim(pg, ids, ops[results.index('blocked')])
    finally:
        pg.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
