/**
 * Copyright (C) 2016 DataStax, Inc.
 *
 * Please see the license for details:
 * http://www.datastax.com/terms/datastax-dse-driver-license-terms
 */
'use strict';
var assert = require('assert');
var util = require('util');
var helper = require('../../../test-helper');
var Client = require('../../../../lib/dse-client');
var vdescribe = helper.vdescribe;
var geometry = require('../../../../lib/geometry');
var types = require('../../../../lib/types');
var utils = require('../../../../lib/utils');
var Point = geometry.Point;
var Polygon = geometry.Polygon;
var Uuid = types.Uuid;
var Tuple = types.Tuple;

vdescribe('dse-5.0', 'Polygon', function () {
  this.timeout(120000);
  before(function (done) {
    var client = new Client(helper.getOptions());
    utils.series([
      function (next) {
        helper.ccm.startAll(1, {}, next);
      },
      client.connect.bind(client),
      function createAll(next) {
        var queries = [
          "CREATE KEYSPACE ks1 WITH replication = {'class': 'SimpleStrategy', 'replication_factor' : 1} and durable_writes = false",
          "USE ks1",
          "CREATE TABLE polygons (id text, value 'PolygonType', PRIMARY KEY (id))",
          "INSERT INTO polygons (id, value) VALUES ('sample1', 'POLYGON ((1 3, 3 1, 3 6, 1 3))')",
          "INSERT INTO polygons (id, value) VALUES ('sample2', 'POLYGON((0 10, 10 0, 10 10, 0 10), (6 7,3 9,9 9,6 7))')",
          "INSERT INTO polygons (id, value) VALUES ('sample3', 'POLYGON EMPTY')",
          "CREATE TABLE keyed (id 'PolygonType', value text, PRIMARY KEY (id))",
          "INSERT INTO keyed (id, value) VALUES ('POLYGON ((1 3, 3 1, 3 6, 1 3))', 'hello')"
        ];
        utils.eachSeries(queries, function (q, eachNext) {
          client.execute(q, eachNext);
        }, next);
      },
      client.shutdown.bind(client)
    ], done);
  });
  it('should parse polygons', function (done) {
    var client = new Client(helper.getOptions());
    utils.series([
      client.connect.bind(client),
      function test(next) {
        client.execute('SELECT * FROM ks1.polygons', function (err, result) {
          assert.ifError(err);
          var map = helper.keyedById(result);
          [
            ['sample1', new Polygon([new Point(1, 3), new Point(3, 1), new Point(3, 6), new Point(1, 3)])],
            ['sample2', new Polygon(
              [new Point(0, 10), new Point(10, 0), new Point(10, 10), new Point(0, 10)],
              [new Point(6, 7), new Point(3, 9), new Point(9, 9), new Point(6, 7)]
            )],
            ['sample3', new Polygon()]
          ]
            .forEach(function (item) {
              var polygon = map[item[0]];
              helper.assertInstanceOf(polygon, Polygon);
              assert.strictEqual(polygon.rings.length, item[1].rings.length);
              polygon.rings.forEach(function (r1, i) {
                var r2 = item[1].rings[i];
                assert.strictEqual(r1.length, r2.length);
                assert.strictEqual(r1.join(', '), r2.join(', '));
                r1.forEach(function (p, j) {
                  p.equals(r2[j]);
                });
              });
            });
          next();
        });
      },
      client.shutdown.bind(client)
    ], done);
  });
  [0, 1].forEach(function (prepare) {
    var name = prepare ? 'prepared' : 'simple';
    it(util.format('should encode polygons for %s queries', name), function (done) {
      var client = new Client(helper.getOptions());
      utils.series([
        client.connect.bind(client),
        function test(next) {
          var values = [
            new Polygon([new Point(1, 3), new Point(3, -11.2), new Point(3, 6.2), new Point(1, 3)]),
            new Polygon(
              [new Point(-10, 10), new Point(10, 0), new Point(10, 10), new Point(-10, 10)],
              [new Point(6, 7), new Point(3, 9), new Point(9, 9), new Point(6, 7)]
            ),
            new Polygon()
          ];
          var insertQuery = 'INSERT INTO ks1.polygons (id, value) VALUES (?, ?)';
          var selectQuery = 'SELECT toJSON(value) as json_value FROM ks1.polygons WHERE id = ?';
          var counter = 0;
          utils.each(values, function (polygon, eachNext) {
            var id = util.format('%s-%d', name, ++counter);
            client.execute(insertQuery, [id, polygon], { prepare: prepare }, function (err) {
              assert.ifError(err);
              client.execute(selectQuery, [id], function (err, result) {
                assert.ifError(err);
                var row = result.first();
                assert.ok(row);
                //use json value to avoid decoding client side in this test
                var value = JSON.parse(row['json_value']);

                // The OGC spec requires that external rings be organized counter clockwise, interior clockwise,
                // but GeoJSON does not require this and in fact the C* json representation returns the opposite.
                // Therefore we normalize the coordinates returned to match our expectation and compare against that.
                // DSP-10257 proposes that C* normalizes the GeoJSON.
                var normalizedCoordinates = [];
                if(value.coordinates) {
                  // We assume that all rings are exactly 4 points based on the input.
                  for(var i = 0; i < value.coordinates.length; i++) {
                    var c = value.coordinates[i];
                    normalizedCoordinates.push([c[0], c[2], c[1], c[3]]);
                  }
                }
                assert.deepEqual(normalizedCoordinates, polygon.toJSON().coordinates);
                eachNext();
              });
            });
          }, next);
        },
        client.shutdown.bind(client)
      ], done);
    });
    it(util.format('should be able to retrieve data where polygon is partition key for %s queries', name), function (done) {
      var client = new Client(helper.getOptions());
      var id = new Polygon([new Point(1, 3), new Point(3, 1), new Point(3, 6), new Point(1, 3)]);
      utils.series([
        client.connect.bind(client),
        function (next) {
          var selectQuery = 'SELECT value FROM ks1.keyed WHERE id = ?';
          client.execute(selectQuery, [id], function (err, result) {
            assert.ifError(err);
            var row = result.first();
            assert.ok(row);
            assert.strictEqual(row['value'], 'hello');
            next();
          });
        },
        client.shutdown.bind(client)
      ], done);
    });
  });
  describe('with collections, tuples and udts', function () {
    var polygon = new Polygon();
    var polygon2 = new Polygon([new Point(1, 3), new Point(3, 1), new Point(3, 6), new Point(1, 3)]);
    before(function (done) {
      var client = new Client(helper.getOptions());
      utils.series([
        client.connect.bind(client),
        function createAll(next) {
          var queries = [
            "use ks1",
            "CREATE TYPE polygont (f text, v 'PolygonType')",
            "CREATE TABLE tbl_udts (id uuid PRIMARY KEY, udt_col frozen<polygont>)",
            "CREATE TABLE tbl_tuple (id uuid PRIMARY KEY, tuple_col tuple<int, 'PolygonType'>)",
            "CREATE TABLE tbl_list (id uuid PRIMARY KEY, list_col list<'PolygonType'>)",
            "CREATE TABLE tbl_set (id uuid PRIMARY KEY, set_col set<'PolygonType'>)",
            "CREATE TABLE tbl_map (id uuid PRIMARY KEY, map_col map<text, 'PolygonType'>)"
          ];
          utils.eachSeries(queries, function (q, eachNext) {
            client.execute(q, eachNext);
          }, next);
        },
        client.shutdown.bind(client)
      ], done);
    });
    [0, 1].forEach(function (prepare) {
      var name = prepare ? 'prepared' : 'simple';
      it(util.format('should create and retrieve polygons in a udt for %s queries', name), function (done) {
        var client = new Client(helper.getOptions());
        var insertQuery = 'INSERT INTO ks1.tbl_udts (id, udt_col) values (?, ?)';
        var selectQuery = 'SELECT udt_col FROM ks1.tbl_udts WHERE id = ?';
        var id = Uuid.random();
        var udt = { f: 'hello', v: polygon};

        utils.series([
          client.connect.bind(client),
          function (next) {
            client.execute(insertQuery, [id, udt], {prepare: prepare, hints: [null, 'udt<ks1.polygont>']}, function (err) {
              assert.ifError(err);
              client.execute(selectQuery, [id], {prepare: prepare}, function (err, result) {
                assert.ifError(err);
                var row = result.first();
                assert.ok(row);
                assert.deepEqual(row['udt_col'], udt);
                next();
              });
            });
          },
          client.shutdown.bind(client)
        ], done);
      });
      var tupleTestCase = it;
      if (prepare === 0) {
        //tuples are not supported in simple statements in the core driver
        //mark it as pending
        tupleTestCase = xit;
      }
      tupleTestCase(util.format('should create and retrieve polygons in a tuple for %s queries', name), function (done) {
        var client = new Client(helper.getOptions());
        var insertQuery = 'INSERT INTO ks1.tbl_tuple (id, tuple_col) values (?, ?)';
        var selectQuery = 'SELECT tuple_col FROM ks1.tbl_tuple WHERE id = ?';
        var id = Uuid.random();
        var tuple = new Tuple(0, polygon);

        utils.series([
          client.connect.bind(client),
          function (next) {
            client.execute(insertQuery, [id, tuple], { prepare: prepare }, function (err) {
              assert.ifError(err);
              client.execute(selectQuery, [id], { prepare: prepare }, function (err, result) {
                assert.ifError(err);
                var row = result.first();
                assert.ok(row);
                assert.deepEqual(row['tuple_col'], tuple);
                next();
              });
            });
          },
          client.shutdown.bind(client)
        ], done);
      });
      ['list', 'set'].forEach(function (colType) {
        it(util.format('should create and retrieve polygons in a %s for %s queries', colType, name), function (done) {
          var client = new Client(helper.getOptions());
          var insertQuery = util.format('INSERT INTO ks1.tbl_%s (id, %s_col) values (?, ?)', colType, colType);
          var selectQuery = util.format('SELECT %s_col FROM ks1.tbl_%s WHERE id = ?', colType, colType);
          var id = Uuid.random();
          var data = [polygon, polygon2];
          utils.series([
            client.connect.bind(client),
            function (next) {
              client.execute(insertQuery, [id, data], {prepare: prepare}, function (err) {
                assert.ifError(err);
                client.execute(selectQuery, [id], {prepare: prepare}, function (err, result) {
                  assert.ifError(err);
                  var row = result.first();
                  assert.ok(row);
                  assert.deepEqual(row[util.format('%s_col', colType)], data);
                  next();
                });
              });
            },
            client.shutdown.bind(client)
          ], done);
        });
      });
      it(util.format('should create and retrieve polygons in a map for %s queries', name), function (done) {
        var client = new Client(helper.getOptions());
        var insertQuery = 'INSERT INTO ks1.tbl_map (id, map_col) values (?, ?)';
        var selectQuery = 'SELECT map_col FROM ks1.tbl_map WHERE id = ?';
        var id = Uuid.random();
        var map = { polygon : polygon };

        utils.series([
          client.connect.bind(client),
          function (next) {
            client.execute(insertQuery, [id, map], {prepare: prepare, hints: [null, types.dataTypes.map]}, function (err) {
              assert.ifError(err);
              client.execute(selectQuery, [id], {prepare: prepare}, function (err, result) {
                assert.ifError(err);
                var row = result.first();
                assert.ok(row);
                assert.deepEqual(row['map_col'], map);
                next();
              });
            });
          },
          client.shutdown.bind(client)
        ], done);
      });
    });
  });
  after(helper.ccm.remove.bind(helper.ccm));
});