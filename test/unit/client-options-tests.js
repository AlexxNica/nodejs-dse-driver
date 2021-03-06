/**
 * Copyright (C) 2016 DataStax, Inc.
 *
 * Please see the license for details:
 * http://www.datastax.com/terms/datastax-dse-driver-license-terms
 */
'use strict';
var assert = require('assert');
var utils = require('../../lib/utils');
var clientOptions = require('../../lib/client-options');
var Client = require('../../lib/dse-client');
var helper = require('../test-helper');

describe('clientOptions', function () {
  describe('createQueryOptions()', function () {
    it('should set payload when executeAs is provided', function () {
      var options = clientOptions.createQueryOptions(new Client(helper.baseOptions), { executeAs: 'bob' });
      assert.ok(options);
      assert.ok(options.customPayload);
      helper.assertBufferString(options.customPayload[clientOptions.proxyExecuteKey], 'bob');
    });
    it('should clone payload when payload and executeAs are provided', function () {
      var userOptions = { executeAs: 'bob2', customPayload: { 'first': utils.allocBufferFromString('one') }};
      var options = clientOptions.createQueryOptions(new Client(helper.baseOptions), userOptions);
      assert.ok(options);
      assert.ok(options.customPayload);
      assert.notStrictEqual(options.customPayload, userOptions.customPayload);
      helper.assertBufferString(options.customPayload['first'], 'one');
      helper.assertBufferString(options.customPayload[clientOptions.proxyExecuteKey], 'bob2');
    });
    it('should set the payload to undefined when not provided', function () {
      var options = clientOptions.createQueryOptions(new Client(helper.baseOptions), { prepare: true });
      assert.ok(options);
      assert.strictEqual(options.customPayload, undefined);
    });
  });
});