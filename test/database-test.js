var path = require('path'),
    assert = require('assert'),
    events = require('events'),
    http = require('http'),
    fs = require('fs'),
    vows = require('vows');

function status(code) {
    return function (e, res) {
        assert.ok(res || e);
        assert.equal((res || e).headers.status || (res || e).status, code);
    };
}

function mixin(target) {
    var objs = Array.prototype.slice.call(arguments, 1);
    objs.forEach(function (o) {
        for (var attr in o) { target[attr] = o[attr] }
    });
    return target;
}

var cradle = require('../lib/cradle');

vows.describe('cradle/database').addBatch({
    "Connection": {
        topic: function () {
            return new(cradle.Connection)('127.0.0.1', 5984, {cache: false});
        },
        "database()": {
            topic: function (c) { return c.database('pigs') },

            "info()": {
                topic: function (db) {
                    db.info(this.callback);
                },
                "returns a 200": status(200),
                "returns database info": function (info) {
                    assert.equal(info['db_name'], 'pigs');
                }
            },
            "fetching a document by id (GET)": {
                topic: function (db) { db.get('mike', this.callback) },
                "returns a 200": status(200),
                "returns the document": function (res) {
                    assert.equal(res.id, 'mike');
                },
                "when not found": {
                    topic: function (_, db) { db.get('tyler', this.callback) },
                    "returns a 404": status(404),
                    "returns the error": function (err, res) {
                        //console.dir(arguments);
                        assert.isObject(err);
                        assert.isObject(err.headers);
                        assert.isUndefined(res);
                    },
                }
            },
            "head()": {
                topic: function (db) { db.head('mike', this.callback) },
                "returns the headers": function (res) {
                    assert.match(res.etag, /^"\d-[a-z0-9]+"$/);
                }
            },
            "save()": {
                "with an id & doc": {
                    topic: function (db) {
                        db.save('joe', {gender: 'male'}, this.callback);
                    },
                    "creates a new document (201)": status(201),
                    "returns the revision": function (res) {
                        assert.ok(res.rev);
                    }
                },
                "with a doc containing non-ASCII characters": {
                    topic: function (db) {
                        db.save('john', {umlauts: 'äöü'}, this.callback);
                    },
                    "creates a new document (201)": status(201)
                },
                "with a large doc": {
                    topic: function (db) {
                        var text = (function (s) {
                            for (var i = 0; i < 18; i++) { s += s }
                            return s;
                        })('blah');

                        db.save('large-bob', {
                            gender: 'male',
                            speech: text
                        }, this.callback);
                    },
                    "creates a new document (201)": status(201)
                },
                "with a '_design' id": {
                    topic: function (db) {
                        db.save('_design/horses', {
                            all: {
                                map: function (doc) {
                                    if (doc.speed == 72) emit(null, doc);
                                }
                            }
                        }, this.callback);
                    },
                    "creates a doc (201)": status(201),
                    "returns the revision": function (res) {
                        assert.ok(res.rev);
                    },
                    "creates a design doc": {
                        topic: function (res, db) {
                            db.view('horses/all', this.callback);
                        },
                        "which can be queried": status(200)
                    }
                },
                "without an id (POST)": {},
            },
            "calling save() with an array": {
                topic: function (db) {
                    db.save([{_id: 'tom'}, {_id: 'flint'}], this.callback);
                },
                "returns an array of document ids and revs": function (res) {
                    assert.equal(res[0].id, 'tom');
                    assert.equal(res[1].id, 'flint');
                },
                "should bulk insert the documents": {
                    topic: function (res, db) {
                        var promise = new(events.EventEmitter);
                        db.get('tom', function (e, tom) {
                            db.get('flint', function (e, flint) {
                                promise.emit('success', tom, flint);
                            });
                        });
                        return promise;
                    },
                    "which can then be retrieved": function (e, tom, flint) {
                        assert.ok(tom._id);
                        assert.ok(flint._id);
                    }
                }
            },
            "getting all documents": {
                topic: function (db) {
                    db.all(this.callback);
                },
                "returns a 200": status(200),
                "returns a list of all docs": function (res) {
                    assert.isArray(res);
                    assert.isNumber(res.total_rows);
                    assert.isNumber(res.offset);
                    assert.isArray(res.rows);
                },
                "which can be iterated upon": function (res) {
                    assert.isFunction(res.forEach);
                }
            },
            "updating a document (PUT)": {
                topic: function (db) {
                    var promise = new(events.EventEmitter);
                    db.get('mike', function (err, doc) {
                        db.save('mike', doc.rev,
                            {color: doc.color, age: 13}, function (err, res) {
                            if (! err) promise.emit('success', res, db);
                            else promise.emit('error', res);
                        });
                    });
                    return promise;
                },
                "returns a 201": status(201),
                "returns the revision": function (res) {
                    assert.ok(res.rev);
                    assert.match(res.rev, /^2/);
                },
            },
            "deleting a document (DELETE)": {
                topic: function (db) {
                    var promise = new(events.EventEmitter);
                    db.get('billy', function (e, res) {
                        db.remove('billy', res.rev, function (e, res) {
                            promise.emit('success', res);
                        });
                    });
                    return promise;
                },
                "returns a 200": status(200)
            },
            "querying a view": {
                topic: function (db) {
                    db.view('pigs/all', this.callback);
                },
                "returns a 200": status(200),
                "returns view results": function (res) {
                    assert.isArray(res.rows);
                    assert.equal(res.rows.length, 2);
                    assert.equal(res.total_rows, 2);
                },
                "returns an iterable object with key/val pairs": function (res) {
                    assert.isArray(res);
                    assert.lengthOf(res, 2);
                    res.forEach(function (k, v) {
                        assert.isObject(v);
                        assert.isString(k);
                        assert.ok(k === 'mike' || k === 'bill');
                    });
                },
                "with options": {

                },
                "with a start & end key": {

                }
            },
            // same as the above test, but with a temporary view
            "querying a temporary view": {
                topic: function (db) {
                    db.temporaryView({
                        map: function (doc) {
                            if (doc.color) emit(doc._id, doc);
                        }
                    }, this.callback);
                },
                "returns a 200": status(200),
                "returns view results": function (res) {
                    assert.isArray(res.rows);
                    assert.equal(res.rows.length, 2);
                    assert.equal(res.total_rows, 2);
                },
                "returns an iterable object with key/val pairs": function (res) {
                    assert.isArray(res);
                    assert.lengthOf(res, 2);
                    res.forEach(function (k, v) {
                        assert.isObject(v);
                        assert.isString(k);
                        assert.ok(k === 'mike' || k === 'bill');
                    });
                },
                "with options": {

                },
                "with a start & end key": {

                }
            },
            "cleaning up a view with viewCleanup()": {
              topic: function (db) {
                db.viewCleanup(this.callback);
              },
              "returns a 202": status(202),
              "no error is thrown and we get ok response": function (e, res) {
                assert.ok(!e);
                assert.ok(res && res.ok && res.ok === true);
              }
            }
        }
    }
}).export(module);