export = () => {
	it("should run decorators in the right order", () => {
		let initiateCount = 0;
		function decorate1(count: number) {
			expect(count).to.equal(initiateCount + 1);
			initiateCount = count;

			return (obj: unknown, index?: unknown, info?: unknown) => {
				compare(obj, count, index, info);
			};
		}
		function decorate2(count: number) {
			expect(count).to.equal(initiateCount + 1);
			initiateCount = count;

			return (obj: unknown, index?: unknown, info?: unknown) => {
				compare(obj, count, index, info);
			};
		}

		const expectedCalls: Array<[number, unknown, unknown]> = [
			[2, "property1", undefined],
			[1, "property1", undefined],
			[8, "function1", 1],
			[7, "function1", 1],
			[6, "function1", 0],
			[5, "function1", 0],
			[4, "function1", {}],
			[3, "function1", {}],
			[10, "property2", undefined],
			[9, "property2", undefined],
			[16, "function2", 1],
			[15, "function2", 1],
			[14, "function2", 0],
			[13, "function2", 0],
			[12, "function2", {}],
			[11, "function2", {}],
			[18, undefined, undefined],
			[17, undefined, undefined],
		];

		let callCount = 0;
		function compare(obj: unknown, count: number, index?: unknown, info?: unknown) {
			const [expectedCount, expectedIndex, expectedInfo] =
				expectedCalls[callCount++] ?? error("Too many decorators called");

			expect(obj).to.equal(Foo);
			expect(count).to.equal(expectedCount);
			expect(index).to.equal(expectedIndex);

			if (typeIs(info, "table") && typeIs(expectedInfo, "table")) {
				// Only for methods - check that .value is equal to the method
				expect((info as { value: Callback }).value).to.equal(Foo[expectedIndex as keyof typeof Foo]);
			} else {
				expect(info).to.equal(expectedInfo);
			}
		}

		/*
			Decorator initialisation order is tested by calling the decorators with the expected numeric order
			And then checking that the calls are always incrementing one by one
			We also check the total count at the end

			Decorator index and info parameters are checked in the compare function against an array of expected results
		*/

		@decorate1(17)
		@decorate2(18)
		class Foo {
			@decorate1(1) @decorate2(2) property1: unknown;

			@decorate1(3)
			@decorate2(4)
			function1(
				@decorate1(5) @decorate2(6) parameter1: unknown,
				@decorate1(7) @decorate2(8) parameter2: unknown,
			) {}

			@decorate1(9) @decorate2(10) property2: unknown;

			@decorate1(11)
			@decorate2(12)
			function2(
				@decorate1(13) @decorate2(14) parameter1: unknown,
				@decorate1(15) @decorate2(16) parameter2: unknown,
			) {}
		}

		expect(initiateCount).to.equal(18);
	});
	it("should apply decorator return values", () => {
		throw "Not implemented";
	});
};

/*

function expect<T>(a: T) {
    return {
        to: {
            equal(b: T) {
                if (a !== b) {
                    console.log(a, b)
                    console.trace("test")
                    throw "Items not equal";
                }
            }
        }
    }
}

type Callback = (...args: any[]) => any

let initiateCount = 0;
function decorate1(count: number) {
    expect(count).to.equal(initiateCount + 1);
    initiateCount = count;

    return (obj: unknown, index?: unknown, info?: unknown) => {
        compare(decorate1, obj, count, index, info);
    };
}
function decorate2(count: number) {
    expect(count).to.equal(initiateCount + 1);
    initiateCount = count;

    return (obj: unknown, index?: unknown, info?: unknown) => {
        compare(decorate2, obj, count, index, info);
    };
}

const expectedCalls: Array<[number, Callback, unknown, unknown]> = [];

let callCount = 0;
function compare(caller: Callback, obj: unknown, count: number, index?: unknown, info?: unknown) {
    expectedCalls.push([count, caller, index, info])
}


@decorate1(17)
@decorate2(18)
class Foo {
    @decorate1(1) @decorate2(2) property1: unknown;

    @decorate1(3)
    @decorate2(4)
    method1(
        @decorate1(5) @decorate2(6) parameter1: unknown,
        @decorate1(7) @decorate2(8) parameter2: unknown,
    ) { }

    @decorate1(9) @decorate2(10) property2: unknown;

    @decorate1(11)
    @decorate2(12)
    method2(
        @decorate1(13) @decorate2(14) parameter1: unknown,
        @decorate1(15) @decorate2(16) parameter2: unknown,
    ) { }
}

expect(initiateCount).to.equal(18);
console.log(expectedCalls)
*/
