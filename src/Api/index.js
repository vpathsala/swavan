import Mock from './server';
import db from '../database';


export class Api {
    mock = null;
    constructor() {
        this.mock = new Mock()
    }
    mockExtractor(response, ) {
        return {
            id: response.data.id,
            status: response.data.status || 200,
            content: response.data.content,
            content_type: response.data.content_type,
            key: response.data.key,
            headers: response.data.headers || []
        }
    }

    async copiedResponses(responses) {
        const ids = responses.map(({ data }) => data.id)
        if ( ids && ids.length > 0 ) {
            const mocks = await this.mock.getByIds(ids)
            const mapMocks = mocks.reduce((result, row) => {
                if (row.status === 200)
                    result[ row.config.url.split('/').slice(-1) ] = row.data
                return result
            }, {})
            const new_responses = responses.map((row) => {
                if ( row.data && row.data.key &&  row.data.id) {
                    const key = row.data.key
                    const id = row.data.id
                    const existingMock = mapMocks[id] || {};
                    row.data = { key, ...existingMock }
                }
                return row
            })
            return this.addResponses(new_responses)
        }
        return []
    }

    async addResponses(responses) {
      const _addResponses = await this.mock.post(responses.map(row => this.mockExtractor(row)))
      if (_addResponses.status === 201) {
        const _responses = _addResponses.data;
        const _createObjectByKey = (result, data) => {
            result[data.key] = data
            return result
        }
        const _responsesDict = _responses.reduce(_createObjectByKey, {})
        const _returnableResponses = responses.map((row) => {
            row.data = _responsesDict[row.data.key];
            return row
        })
        return _returnableResponses
      }
      return []
    }

    async editResponses(responses) {
        const _updatedRecords = responses.filter(row => row.data && row.data.content);

        if (_updatedRecords && _updatedRecords.length > 0 ) {
            await this.mock.put(_updatedRecords.map(row => this.mockExtractor(row)))
        }
        responses.forEach((row) => {
            const { id, key, link } = row.data
            row.data = { id, key, link}
        })
        return responses
    }

    async deleteResponses(responses) {
        if(responses.length > 0) {
            await this.mock.delete(responses.map(row => ({ "id": row.data.id, "key": row.data.key })))
        }
    }

    async updateRuleSettings(id, payload) {
        await db.rules.update(id, { ...payload }) 
    }
    async saveRule(rule) {
        const _allResponses = rule.responses;
        const _deleteResponses = _allResponses.filter(res => res.mark_for_deletion || (res.data && res.data.action_perform && res.data.action_perform == 'd'));

        const _responses = _allResponses.filter(res => !res.mark_for_deletion || (res.data && res.data.action_perform && res.data.action_perform !== 'd'));
        
        const _redirectResponses = _responses.filter(res => res.data_source_type === 'r');
        const _blockResponses = _responses.filter(res => res.data_source_type === 'b');
        const _saveLocalResponses = _responses.filter(res => res.data_source_type === 'd' && res.cloud_store_permission !== 'a' );
        const mockResponses = _responses.filter(res => res.data_source_type === 'd' && res.cloud_store_permission === 'a');
        const _addResponses = mockResponses.filter(res => res.data.action_perform === 'a');
        const _editResponses = mockResponses.filter(res => res.data.action_perform === 'e');
        const _copyResponses = mockResponses.filter(res => res.data.action_perform === 'c');
        const _mockResponses = [];

        if(_addResponses && _addResponses.length  > 0) {
            const _added = await this.addResponses(_addResponses);
            _mockResponses.push(..._added)
        }

        if(_copyResponses && _copyResponses.length  > 0) {
            const _added = await this.copiedResponses(_copyResponses);
            _mockResponses.push(..._added)
        }

        if(_editResponses  && _editResponses.length  > 0) {
            const _edited = await this.editResponses(_editResponses);
            _mockResponses.push(..._edited)
        }

        if(_deleteResponses  && _deleteResponses.length  > 0) {
            await this.deleteResponses(_deleteResponses.filter(res => res.data_source_type === 'd'))
        }

        rule.responses = [ ..._saveLocalResponses, ..._mockResponses,  ..._redirectResponses, ..._blockResponses]

        await db.transaction('rw', db.rules, async function() {
            if(rule.id) {
                await db.rules.put(rule)
            } else {
                delete rule.id
                await db.rules.add(rule)
            }
        })
    }

    async deleteRule(rule) {
        if (rule && rule.responses && rule.responses.length > 0) {
            const delete_responses = rule.responses.filter(res => res.data && res.data.id && res.data.key && res.cloud_store_permission === 'a');

            if (delete_responses && delete_responses.length > 0) {
                this.mock.delete(delete_responses.map(row => ({ "id": row.data.id, "key": row.data.key })))
            }
        }
        await db.transaction('rw', db.rules, async function() {
            await db.rules
            .where("id")
            .equals(rule.id)
            .delete();
        })
    }
    async getResponses(rule_id) {
        const mock_data = await this.mock.get(rule_id);
        return  mock_data
    }
    async loadRule(search) {
        let rules = await db.rules
        .filter(rule => search ? rule.name.toLowerCase().includes(search.toLowerCase()): rule)
        .toArray()

        return rules
    }
    async loadRuleByID(id) {
        const rule = await db.rules.get(id)
        return rule
    }
    async saveSettings(data) {
        await db.transaction('rw', db.settings, async function() {
            if(data.id) {
                await db.settings.put(data)
            } else {
                await db.settings.add(data)
            }
        })
    }
    async loadSettings() {
        const status =  await db.settings.toArray()
        return status
    }
    async saveHostURL(url) {
        await db.transaction('rw', db.hostURLs, async function() {
            await db.hostURLs.add({url: url})
        })

    }
    async deleteHostURL(id) {
        await db.transaction('rw', db.hostURLs, async function() {
            await db.hostURLs
            .where("id")
            .equals(id)
            .delete();
        })
    }
    async loadHostURL(search) {
       const urls =  await db.hostURLs
        .filter(row => search ? row.url.includes(search): row)
        .toArray();
        return urls
    }

    async loadRequestFilterTypes() {
        const _requestFilterTypes =  await db.requestFilterTypes.toArray();
        if (_requestFilterTypes && _requestFilterTypes.length > 0) {
            return _requestFilterTypes[0];
        }
        return { "id": null, "types": []}
    }
    async saveRequestFilterTypes(payload) {
        await db.transaction('rw', db.requestFilterTypes, async function() {
            if (payload.id) {
                await db.requestFilterTypes.put(payload)
            } else {
                delete payload.id
                await db.requestFilterTypes.add(payload)
            }
        })
    }
}

const api = new Api();
export default api
