/**
 * SF-Intel Studio - Canonical Log Parser
 * Implementation of MSFX Canonical Execution Event Model
 * 
 * CORE PRINCIPLE:
 * Logs are an input format.
 * Execution events are the data model.
 * UI consumes data, never raw logs.
 */

const EventType = {
    EXECUTION_STARTED: 'EXECUTION_STARTED',
    EXECUTION_FINISHED: 'EXECUTION_FINISHED',
    CODE_UNIT_STARTED: 'CODE_UNIT_STARTED',
    CODE_UNIT_FINISHED: 'CODE_UNIT_FINISHED',
    METHOD_ENTRY: 'METHOD_ENTRY',
    METHOD_EXIT: 'METHOD_EXIT',
    SOQL_EXECUTE_BEGIN: 'SOQL_EXECUTE_BEGIN',
    SOQL_EXECUTE_END: 'SOQL_EXECUTE_END',
    DML_BEGIN: 'DML_BEGIN',
    DML_END: 'DML_END',
    SYSTEM_METHOD_ENTRY: 'SYSTEM_METHOD_ENTRY',
    SYSTEM_METHOD_EXIT: 'SYSTEM_METHOD_EXIT',
    USER_DEBUG: 'USER_DEBUG',
    EXCEPTION_THROWN: 'EXCEPTION_THROWN',
    FATAL_ERROR: 'FATAL_ERROR',
    LIMIT_USAGE: 'LIMIT_USAGE'
};

class LogParser {
    /**
     * Parses raw log text into a flat list of CanonicalExecutionEvents.
     * @param {string} rawLog 
     * @returns {Array<CanonicalExecutionEvent>}
     */
    static parse(rawLog) {
        if (!rawLog) return [];

        const events = [];
        const lines = rawLog.split('\n');
        const stack = []; // Stores { eventId, type, startTime }
        let sequence = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const token = LogParser.tokenize(line);

            // Handle multi-line strings (continuation)
            if (!token) {
                if (events.length > 0) {
                    const lastEvent = events[events.length - 1];
                    // Only append to payload if acceptable type
                    if (lastEvent.eventType === EventType.USER_DEBUG || lastEvent.eventType === EventType.LIMIT_USAGE) {
                        lastEvent.payload.raw += '\n' + line;
                        if (lastEvent.payload.limitInfo && lastEvent.eventType === EventType.LIMIT_USAGE) {
                            lastEvent.payload.limitInfo = line; // Update limit info if it was actually the line content
                        }
                    }
                }
                continue;
            }

            const { timestamp, nanos, type, detail } = token;

            // Classification
            const eventType = type; // Map if necessary
            const source = LogParser.classifySource(eventType);
            const parent = stack.length > 0 ? stack[stack.length - 1] : null;

            // Parse specific payload fields
            const parsedPayload = LogParser.parsePayload(eventType, detail);

            const event = {
                eventId: `evt_${sequence}`,
                eventType: eventType,
                timestamp: timestamp,
                nanos: nanos,
                sequence: sequence++,
                depth: stack.length,
                parentEventId: parent ? parent.eventId : null,
                source: source,
                payload: {
                    raw: line,
                    detail: detail,
                    parsed: parsedPayload,
                    line: LogParser.extractLineNumber(detail)
                },
                limitSnapshot: null
            };

            // Logic for Stack Operations
            if (LogParser.isStartEvent(eventType)) {
                stack.push({
                    eventId: event.eventId,
                    type: eventType,
                    nanos: nanos
                });
                events.push(event);
            } else if (LogParser.isEndEvent(eventType)) {
                // Pop matching start event
                // In robust parsing, we might need to handle mismatches
                if (stack.length > 0) {
                    const lastStack = stack[stack.length - 1];
                    // Ideally check if matches, for now assume strictly well-formed or greedy pop
                    stack.pop();

                    // Attach duration to the START event (optional, but helpful for UI projection later)
                    // We can also emit the END event as a discrete event in the graph

                    // For canonical model, we emit the END event too
                    events.push(event);

                    // Note: If we want "One node with duration" in Tree, the Projector will merge 'Start' and 'End'
                } else {
                    // Orphaned end event
                    events.push(event);
                }
            } else {
                // Atomic events (DEBUG, LIMITS, etc)
                if (eventType === EventType.LIMIT_USAGE) {
                    event.payload.limitInfo = detail;
                }
                events.push(event);
            }
        }

        return events;
    }

    static tokenize(line) {
        // 1. Check for Limit Usage (no timestamp usually)
        // Regex: (Number of|Maximum) ...
        const limitMatch = line.match(/^(Number of|Maximum) [a-zA-Z ]+:/);
        if (limitMatch) {
            return {
                timestamp: null,
                nanos: 0,
                type: EventType.LIMIT_USAGE,
                detail: line
            };
        }

        // 2. Standard Event
        // HH:mm:ss.SSS (nanos)|TYPE|...
        const match = line.match(/^(\d{2}:\d{2}:\d{2}\.\d+)\s\((\d+)\)\|(\w+)(?:\|(.*))?$/);
        if (!match) return null;

        const [, timestamp, nanosStr, type, detailStr] = match;
        return {
            timestamp,
            nanos: parseInt(nanosStr),
            type,
            detail: detailStr || ''
        };
    }

    static parsePayload(type, detail) {
        const parsed = {};
        if (!detail) return parsed;

        if (type === EventType.USER_DEBUG) {
            // Format: [Line]|Level|Message or Level|Message
            const parts = detail.split('|');
            // Heuristic using regex for line number [123]
            if (parts[0].match(/^\[\d+\]$/)) {
                parsed.lineNumber = parseInt(parts[0].slice(1, -1));
                parsed.level = parts[1];
                parsed.debugValue = parts.slice(2).join('|');
            } else {
                parsed.level = parts[0];
                parsed.debugValue = parts.slice(1).join('|');
            }
        } else if (type === EventType.EXCEPTION_THROWN || type === EventType.FATAL_ERROR) {
            // Often: [Line]|Error Message
            const parts = detail.split('|');
            if (parts[0].match(/^\[\d+\]$/)) {
                parsed.lineNumber = parseInt(parts[0].slice(1, -1));
                parsed.exceptionMessage = parts.slice(1).join('|');
            } else {
                parsed.exceptionMessage = detail;
            }
        }
        return parsed;
    }

    static classifySource(type) {
        if (type === 'USER_DEBUG') return 'apex';
        if (type.startsWith('SOQL')) return 'db';
        if (type.startsWith('DML')) return 'db';
        if (type.includes('CODE_UNIT') || type.includes('EXECUTION')) return 'platform';
        if (type.startsWith('SYSTEM')) return 'system';
        if (type.startsWith('METHOD')) return 'apex';
        return 'system';
    }

    static isStartEvent(type) {
        return [
            EventType.EXECUTION_STARTED,
            EventType.CODE_UNIT_STARTED,
            EventType.METHOD_ENTRY,
            EventType.SOQL_EXECUTE_BEGIN,
            EventType.DML_BEGIN,
            EventType.SYSTEM_METHOD_ENTRY
        ].includes(type);
    }

    static isEndEvent(type) {
        return [
            EventType.EXECUTION_FINISHED,
            EventType.CODE_UNIT_FINISHED,
            EventType.METHOD_EXIT,
            EventType.SOQL_EXECUTE_END,
            EventType.DML_END,
            EventType.SYSTEM_METHOD_EXIT
        ].includes(type);
    }

    static extractLineNumber(detail) {
        if (!detail) return null;
        // Check [123]
        const match = detail.match(/^\[(\d+)\]/);
        if (match) return parseInt(match[1]);
        return null;
    }
}

if (typeof window !== 'undefined') {
    window.LogParser = LogParser;
    window.CanonicalEventType = EventType;
}
