// Time intervals
const SEC = 1e3;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 12 * MONTH;

class CandleChart {
	#dragging = false;

	// Grid steps
	gridDeltas = [ MIN, 30 * MIN,  HOUR, 3 * HOUR, DAY, 3 * DAY, WEEK, 2 * WEEK, MONTH, 3 * MONTH, 6 * MONTH, YEAR, 2 * YEAR, 5 * YEAR, 10 * YEAR ];

	// Desired gap size
	gapSizeDesired = 1;

	// Data ranges
	#rangeX = [ 0, 0 ];
	#rangeY = [ 0, 0 ];
	#maxV = 0;
	#rangeV = 0;
	#dX = 0;
	#mouse = [ -1, -1 ];
	#box = null;

	#dataLimitLow = null;
	#dataLimitHigh = null;

	// Max and min scale
	#maxSticks = null;
	#minSticks = null;
	#maxValPercentage = .2; // Max 'value' block height

	// Styles
	chartBgStyle = "#fff";
	posStyle = "#5f5";
	negStyle = "#f55";
	posStyleBri = "#0f0";
	negStyleBri = "#f00";
	posStyleDim = "#afa";
	negStyleDim = "#faa";
	gridStyle = "#ddd";

	// Legend paddings
	#legendRight = 100;
	#legendBottom = 25;

	// Data request callback
	dataReqCb = null;
	#reqBlock = false;
	blockSize = 2000;

	// Data
	#data = null;
	#lastPrice = null;

	// Lock cursor when scrolling or not
	captureCursor = true;

	// A constructor
	constructor(node) {
		// Register node and context
		this.node = node;
		this.node.style.imageRendering = "pixelated";
		this.node.style.cursor = "crosshair";
		if (node.tagName != "CANVAS") throw "Cannot convert node to a chart: not a <canvas>!";
		this.ctx = this.node.getContext("2d");
		this.#updateDOM({ attributeName: "dummyMutation" });

		// Register maxSticks and minSticks
		Object.defineProperty(this, "maxSticks", {
						configurable: false,
						get: () => this.#maxSticks,
						set: (v) => {
							this.#maxSticks = v;
							this.#updateMinMaxRange();
						}
					});
		Object.defineProperty(this, "minSticks", {
						configurable: false,
						get: () => this.#minSticks,
						set: (v) => {
							this.#minSticks = v;
							this.#updateMinMaxRange();
						}
					});
		Object.defineProperty(this, "maxValPercentage", {
						configurable: false,
						get: () => this.#maxValPercentage,
						set: (v) => {
							this.#maxValPercentage = v;
							this.update();
						}
					});

		// Register events
		this.node.addEventListener("mousedown", e => {
			if (this.#box != null) if (!this.#box[4]) {
				this.#box[4] = true;
				return;
			}
			if (e.shiftKey) {
				// Start drawing a box
				const rect = this.node.getBoundingClientRect();
				const dpi = window.devicePixelRatio;
				this.#box = [ (e.clientX - rect.left) * dpi, (e.clientY - rect.top) * dpi, 0, 0, false ]
				this.#box[2] = this.#box[0];
				this.#box[3] = this.#box[1];
				return;
			}
			this.#dragging = true;
			this.#box = null;
			if (this.captureCursor) this.node.requestPointerLock();
		});
		this.node.addEventListener("mouseup", e => {
			this.#dragging = false;
			if (this.captureCursor) document.exitPointerLock();
		});
		this.node.addEventListener("mousemove", e => {
			const rect = this.node.getBoundingClientRect();
			const dpi = window.devicePixelRatio;
			this.#mouse = [ (e.clientX - rect.left) * dpi, (e.clientY - rect.top) * dpi ];
			if (this.#box != null) if (!this.#box[4]) {
				this.#box[2] = (e.clientX - rect.left) * dpi;
				this.#box[3] = (e.clientY - rect.top) * dpi;
				this.update();
				return;
			}
			if (this.#dragging) {
				const scaleX = (this.#rangeX[1] - this.#rangeX[0]) / this.getW()
				const scaleY = (this.#rangeY[1] - this.#rangeY[0]) / this.getH()
				this.#rangeX[0] -= e.movementX * scaleX;
				this.#rangeX[1] -= e.movementX * scaleX;
				this.#rangeY[0] += e.movementY * scaleY;
				this.#rangeY[1] += e.movementY * scaleY;
			}
			this.update();
		});
		this.node.addEventListener("mouseleave", e => { this.#mouse = [ -1, -1 ]; this.update(); });
		this.node.addEventListener("wheel", e => {
			let factor = (e.deltaY > 0) ? 1.1 : 1/1.1;
			e.preventDefault();
			if (e.ctrlKey)	{
				const newRange = this.#scaleRange(this.#rangeY, factor);
				if (this.#box != null) {
					const boxRange = this.#scaleRange(
									[ this.#iccY(this.#box[1]), this.#iccY(this.#box[3]) ],
									1/factor, (this.#rangeY[0] + this.#rangeY[1]) / 2);
					this.#box[1] = this.#ccY(boxRange[0]);
					this.#box[3] = this.#ccY(boxRange[1]);
				}
				this.#rangeY = newRange;
				this.#rangeV *= factor;
			} else {
				const screenSticks = this.#getOnscreenSticks();
				let resize = true;
				if (this.#maxSticks != null) if (screenSticks * factor > this.#maxSticks)
					resize = false;
				if (this.#minSticks != null) if (screenSticks * factor < this.#minSticks)
					resize = false;
				if (resize) {
					const newRange = this.#scaleRange(this.#rangeX, factor);
					if (this.#box != null) {
						const boxRange = this.#scaleRange(
									[ this.#iccX(this.#box[0]), this.#iccX(this.#box[2]) ],
									1/factor, (this.#rangeX[0] + this.#rangeX[1]) / 2)
						this.#box[0] = this.#ccX(boxRange[0]);
						this.#box[2] = this.#ccX(boxRange[1]);
					}
					this.#rangeX = newRange;
				}
			}
			this.update();
		});

		this.node.addEventListener("dblclick", e => {
			let sliceStart = this.#data.length - this.maxSticks;
			sliceStart = Math.ceil(sliceStart / 2);
			if (sliceStart < 0) sliceStart = 0;
			const sliceEnd = this.#data.length - sliceStart;
			/*
			// Uncomment this to autorescale X as well (janky)
			let minX = this.#data[sliceStart].timeOpen;
			let maxX = this.#data[sliceEnd - 1].timeOpen;
			this.#rescaleX(minX, maxX);
			*/

			const dataSlice = this.#data.slice(sliceStart, sliceEnd);
			const minY = dataSlice.reduce((pv, e) => { const nv = parseFloat(e.priceLow);	return (pv > nv) ? nv : pv; }, Number.MAX_VALUE);
			const maxY = dataSlice.reduce((pv, e) => { const nv = parseFloat(e.priceHigh);	return (pv < nv) ? nv : pv; }, Number.MIN_VALUE);
			this.#rescaleY(minY, maxY);
		});
		// new ResizeObserver(() => this.resize()).observe(this.node);
		new MutationObserver(
			mutations => mutations.forEach(m => this.#updateDOM(m))
		).observe(this.node, { attributes: true, subtree: true });
	}

	// When canvas tag is updated
	#updateDOM(mutation) {
		if (!mutation) return;
		if ((mutation.attributeName == "width") || (mutation.attributeName == "height")) return;
		this.captureCursor = !this.node.hasAttribute("nocapture");
		const style = window.getComputedStyle(this.node);
		this.ctx.font = style.font;
		this.#legendBottom = parseInt(style["font-size"]) * 2;
		this.#legendRight = this.ctx.measureText(" 99 MON 'YR ").width;
		if (this.#data != null) this.update();
	}

	// Scale range by a factor
	#scaleRange(range, sFactor, sCenter = null) {
		if (sCenter == null) sCenter = (range[1] + range[0]) / 2;
		return [ sCenter + (range[0] - sCenter) * sFactor, sCenter + (range[1] - sCenter) * sFactor ];
	}

	// Rescale axes
	#rescaleX(min, max) {
		this.#rangeX = [ min, max ];
	}
	#rescaleY(min, max) {
		this.#rangeY = [ min, max ];
	}

	// Convert coordinates
	#sdX(x) { return x * this.getW() / (this.#rangeX[1] - this.#rangeX[0]);	}
	#sdY(y) { return y * this.getH() / (this.#rangeY[1] - this.#rangeY[0]); }
	#ccX(x) {
		const rX = this.#rangeX[1] - this.#rangeX[0];
		const dx = x - this.#rangeX[0];
		return dx * this.getW() / rX;
	}
	#ccY(y) {
		const rY = this.#rangeY[1] - this.#rangeY[0];
		const dy = y - this.#rangeY[0];
		return this.getH() - dy * this.getH() / rY;
	}
	#iccX(X) { return this.#rangeX[0] + X * (this.#rangeX[1] - this.#rangeX[0]) / this.getW(); }
	#iccY(Y) { return this.#rangeY[1] - Y * (this.#rangeY[1] - this.#rangeY[0]) / this.getH(); }

	// Get vertical grid lines
	#getGridY() {
		const rDelta = this.#rangeY[1] - this.#rangeY[0];
		let factor = 1;
		if (rDelta < 1)	{ for (; factor >= rDelta; factor /= 10); /* factor *= 10; */ }
		else		{ for (; factor <= rDelta; factor *= 10); factor /= 10; }
		if (this.#sdY(2 * factor) >= this.getH()) factor /= 3;
		let result = [];

		let tick = this.#rangeY[0] - this.#rangeY[0] % factor;
		do {
			if ((tick >= this.#rangeY[0]) && (tick <= this.#rangeY[1])) result.push(tick);
			tick += factor;
		} while (tick <= this.#rangeY[1] + factor);
		return result;
	}
	#getGridXDelta() {
		const rDelta = this.#rangeX[1] - this.#rangeX[0];
		for (var dI = 0; this.#sdX(this.gridDeltas[dI]) <= 1.2 * this.#legendRight; ++dI);
		return this.gridDeltas[dI];
	}
	#getGridX() {
		const delta = this.#getGridXDelta();
		let result = [];
		let tick = this.#rangeX[0] - this.#rangeX[0] % delta - 2 * delta;

		do {
			if ((tick >= this.#rangeX[0]) && (tick <= this.#rangeX[1])) result.push(tick);
			tick += delta;
		} while (tick <= this.#rangeX[1] + 2 * delta);

		return result;
	}

	// Draw grid
	#drawGrid() {
		this.#getGridX().forEach(xG => {
			this.ctx.beginPath();
			const x = this.#ccX(xG);
			this.ctx.moveTo(x, 0);
			this.ctx.lineTo(x, this.getH());
			this.ctx.strokeStyle = this.gridStyle;
			this.ctx.stroke();
		});
		this.#getGridY().forEach(yG => {
			this.ctx.beginPath();
			const y = this.#ccY(yG);
			this.ctx.moveTo(0, y);
			this.ctx.lineTo(this.getW(), y);
			this.ctx.strokeStyle = this.gridStyle;
			this.ctx.stroke();
		});
	}

	// Format date to string
	#fmtDate(unixTime) {
		const d = new Date(unixTime);
		const mon = d.toLocaleString("default", { month: "short" });
		const hm = ` ${d.getHours()}:` + `${d.getMinutes()}`.padStart(2, "0");
		return `${d.getDate()} ${mon} '${d.getFullYear() % 100}` + ((this.#getGridXDelta() >= DAY) ? " " : hm);
	}
	// Format Y value
	#fmtValue(val) {
		// Value to scientific notation
		const pixel = (this.#rangeY[1] - this.#rangeY[0]) / this.getH();
		let factor = 1; let pow = 0;
		for (; factor < this.#rangeY[1]; ++pow, factor *= 10);
		for (; factor / 10 > pixel; --pow, factor /= 10);
		let vC = Math.round(val / factor * 10000) * factor / 10000; // Throw in extra precision
		vC = vC.toFixed((pow < 0) ? -pow : 2);
		if (this.ctx.measureText(vC).width <= this.#legendRight) return vC;
		return `${(val / factor).toFixed(1)}e${pow}`;
	}

	// Get amount of candles that fits on the screen
	#getOnscreenSticks() {
		return (this.#rangeX[1] - this.#rangeX[0]) / this.#dX + 1;
	}

	// Rescale a graph to the range
	#updateMinMaxRange() {
		if (this.#data == null) return;
		const screenSticks = this.#getOnscreenSticks();
		if (this.#maxSticks != null) if (screenSticks > this.#maxSticks)
			this.#rangeX = this.#scaleRange(this.#rangeX, this.#maxSticks / screenSticks);
		if (this.#minSticks != null) if (screenSticks < this.#minSticks)
			this.#rangeX = this.#scaleRange(this.#rangeX, this.#minSticks / screenSticks);
		this.update();
	}

	// Resize event
	resize() {
		// Get the DPI
		const dpi = window.devicePixelRatio;
		const style = window.getComputedStyle(this.node);

		this.node.height = Math.floor(style.height.slice(0, -2) * dpi);
		this.node.width = Math.floor(style.width.slice(0, -2) * dpi);
	}

	getW() { return this.node.width - this.#legendRight; }
	getH() { return this.node.height - this.#legendBottom; }

	#drawHLineAt(yValue, lineStyle = "#000", drawLine = true) {
		let y = this.#ccY(yValue);
		if (drawLine) {
			this.ctx.setLineDash([ 5, 5 ]);
			this.ctx.strokeStyle = lineStyle;
			this.ctx.beginPath();
			this.ctx.moveTo(0, y);
			this.ctx.lineTo(this.getW(), y);
			this.ctx.stroke();
		}
		y = Math.min(Math.max(this.#legendBottom / 2, y), this.getH() - this.#legendBottom / 2);
		this.ctx.fillStyle = lineStyle;
		this.ctx.fillRect(this.getW(), y - this.#legendBottom / 2, this.#legendRight, this.#legendBottom);
		this.ctx.fillStyle = "#fff";
		this.ctx.fillText(this.#fmtValue(yValue), this.getW() + this.#legendRight / 2, y + this.#legendBottom / 6);
	}

	#drawVLineAt(xValue, lineStyle = "#000", drawLine = true) {
		let x = this.#ccX(xValue);
		if (drawLine) {
			this.ctx.setLineDash([ 5, 5 ]);
			this.ctx.strokeStyle = lineStyle;
			this.ctx.beginPath();
			this.ctx.moveTo(x, 0);
			this.ctx.lineTo(x, this.getH());
			this.ctx.stroke();
		}
		x = Math.min(Math.max(x, this.#legendRight / 2), this.getW() - this.#legendRight / 2);
		this.ctx.fillStyle = lineStyle;
		this.ctx.fillRect(x - this.#legendRight / 2, this.getH(), this.#legendRight, this.#legendBottom);
		this.ctx.fillStyle = "#fff";
		this.ctx.fillText(this.#fmtDate(xValue), x, this.getH() + this.#legendBottom * 2 / 3);
	}

	#getDateDiff(d1, d2) {
		const dd2 = new Date(d2);
		const dd1 = new Date(d1);
		const dsec = (d2 - d1) / 1000;

		const days = Math.floor(dsec / 60 / 60 / 24);
		const hours = Math.floor(dsec / 60 / 60 - days * 24);
		const minutes = Math.floor(dsec / 60 - hours * 60 - days * 24 * 60)
		return {
			days: days,
			hours: hours,
			minutes: minutes,
		};
	}

	// Request more data
	// rPos = 1 -> next block
	// rPos = -1 -> previous block
	async #requestBlockAt(rPos) {
		if (this.#reqBlock) return;
		this.#reqBlock = true;
		await this.#requestBlockAtInner(rPos);
		this.#reqBlock = false;
	}
	async #requestBlockAtInner(rPos) {
		let dataRange = [ this.#data[0].timeOpen, this.#data[this.#data.length - 1].timeOpen ];
		let endTime = dataRange[(rPos < 0) ? 0 : 1] + ((rPos < 0) ? 0 : (this.#dX * this.blockSize));
		let startTime = endTime - this.#dX * this.blockSize;

		// console.log(`New block request at position ${rPos}`);
		if ((rPos > 0) && (endTime - dataRange[1] < SEC)) {
			// console.log("Request declined: requested data within obtained!");
			return;
		}
		if ((rPos < 0) && (endTime - this.#dX * this.blockSize - dataRange[0] > SEC)) {
			// console.log("Request declined: requested data within obtained!");
			return;
		}
		if (this.#dataLimitHigh != null)
			// High data limit was reached
			if ((rPos > 0) && (dataRange[1] - this.#dataLimitHigh >= -SEC)) {
				// Data is already full
				// console.log(`Declined request: hit high data range! (${new Date(this.#dataLimitHigh)})`);
				return;
			}
		if (this.#dataLimitLow != null)
			if ((rPos < 0) && (this.#dataLimitLow - dataRange[0] >= -SEC)) {
				// Data is already full
				// console.log(`Declined request: hit low data range! (${new Date(this.#dataLimitLow)})`);
				return;
			}
		/*
		const now = new Date().getTime();
		if (endTime > now) {
			if (now - this.#rangeX[1] <= this.#dX * this.blockSize / 10) { this.#reqBlock = false; return; }
			endTime = now;
		}
		*/

		if (this.dataReqCb == null) return;
		let newBlock = await this.dataReqCb(rPos, Math.round(endTime));
		newBlock = newBlock.sort((a, b) => (a.timeOpen < b.timeOpen) ? -1 : 1);

		// Remove block overlaps
		if (rPos < 0) {
			/*
			 * [#####] newBlock
			 *     [#########] data
			 *     |<-- idx
			 */
			const idx = newBlock.findIndex((e, i, a) => (e.timeOpen >= this.#data[0].timeOpen));
			if (idx > 0) newBlock = newBlock.slice(0, idx);
			else {
				if (endTime - this.#dX * this.blockSize >= dataRange[0]) {
					console.log("Request declined: requested data within obtained!");
					return;
				}
				// No new data in the block
				this.#dataLimitLow = this.#data[0].timeOpen;
				return;
			}
		} else {
			/*
			 * [########] data
			 *       [#####] newBlock
			 *           |<-- idx
			 */
			const idx = newBlock.findIndex((e, i, a) => (e.timeOpen > this.#data[this.#data.length - 1].timeOpen));
			if (idx >= 0) newBlock = newBlock.slice(idx, newBlock.length);
			else {
				if (endTime <= dataRange[1]) {
					console.log("Request declined: requested data within obtained!");
					return;
				}
				// No new data was recieved
				this.#dataLimitHigh = this.#data[this.#data.length - 1].timeOpen;
				/*
				console.log(`New high limit for data: ${new Date(this.#dataLimitHigh)}`);
				console.log(`EndTime: ${new Date(endTime)}`);
				console.log(`Highest time recieved: ${new Date(newBlock[newBlock.length - 1].timeOpen)}`);
				console.log(`dataRange[1]: ${new Date(dataRange[1])}`);
				*/
				return;
			}
		}
		
		// Append new data
		let newData = (rPos < 0) ? newBlock.concat(this.#data) : this.#data.concat(newBlock);

		// Unload execess data
		const maxData = this.#maxSticks + this.blockSize * 4;
		newData = newData.sort((a, b) => (a.timeOpen < b.timeOpen) ? -1 : 1);
		if (newData.length > maxData) {
			if (rPos < 0)	// Added to the start
				newData = newData.slice(0, maxData);
			else		// Added to the end
				newData = newData.slice(newData.length - maxData, newData.length);
		}
		this.#data = newData;
		// Rescale value range
		this.#rangeV = this.#data.reduce((pv, e) => { const nv = parseFloat(e.volume); return (pv < nv) ? nv : pv; }, Number.MIN_VALUE);
		this.#maxV = this.#rangeV;
		this.update();
	}

	// Redraw the chart
	update(data = null, rescale = [ true, true ], setLastPrice = true) {
		this.resize();
		if (data != null) {
			// Update data
			this.#data = data.sort((a, b) => (a.timeOpen < b.timeOpen) ? -1 : 1);;
			if (rescale[0]) {
				// Rescale X to data
				const maxX = this.#data.reduce((pv, e) => {
					const nv = e.timeOpen;
					return (pv < nv) ? nv : pv;
				}, Number.MIN_SAFE_INTEGER);
				const minX = this.#data.reduce((pv, e) => {
					const nv = e.timeOpen;
					return (pv > nv) ? nv : pv;
				}, Number.MAX_SAFE_INTEGER);
				this.#rescaleX(minX, maxX);
				this.#dX = (this.#rangeX[1] - this.#rangeX[0]) / this.#data.length;
			}
			if (rescale[1]) {
				// Rescale Y to data
				const maxY = this.#data.reduce((pv, e) => { const nv = parseFloat(e.priceHigh);	return (pv < nv) ? nv : pv; }, Number.MIN_VALUE);
				const minY = this.#data.reduce((pv, e) => { const nv = parseFloat(e.priceLow);	return (pv > nv) ? nv : pv; }, Number.MAX_VALUE);
				this.#rescaleY(minY, maxY);
			}
			// Rescale value range
			this.#rangeV = this.#data.reduce((pv, e) => { const nv = parseFloat(e.volume); return (pv < nv) ? nv : pv; }, Number.MIN_VALUE);
			this.#maxV = this.#rangeV;
			if (setLastPrice)
				this.#lastPrice = this.#data[this.#data.length - 1];
		}

		if (this.#data == null) return;

		// Draw the chart
		// Clear background
		this.ctx.clearRect(0, 0, this.node.width, this.node.height);
		// Draw chart field
		this.ctx.fillStyle = this.chartBgStyle;
		this.ctx.fillRect(0, 0, this.getW(), this.getH());
		// Draw major and minor grids
		this.#drawGrid();
		// Draw chart
		const start = this.#data.findIndex((e, i, a) => (this.#ccX(e.timeOpen) > 0));
		if (start >= 0) {
			const sticks = this.#getOnscreenSticks()
			let cHW = (this.#sdX(this.#dX) - this.gapSizeDesired) / 2; // Candle half-width
			if (cHW <= 0) cHW = 1;
			if (start < this.blockSize) this.#requestBlockAt(-1);
			if (this.#data.length - start - sticks < this.blockSize) this.#requestBlockAt(1);
			// Iterate over only frame of this.#maxSticks * 2
			let vScale = this.getH() / this.#rangeV * .35;
			if (this.#maxV * vScale / this.getH() >= this.#maxValPercentage)
				vScale *= this.#maxValPercentage * this.getH() / (this.#maxV * vScale);
			this.#data.slice(start, this.#data.length).forEach(dp => {
				const x = this.#ccX(dp.timeOpen);
				if ((x < 0) || (x >= this.getW())) return;
				const yTop = this.#ccY(Math.max(dp.priceOpen, dp.priceClose));
				const yBot = this.#ccY(Math.min(dp.priceOpen, dp.priceClose));
				const y2Top = this.#ccY(dp.priceHigh);
				const y2Bot = this.#ccY(dp.priceLow);

				const bright = (x - cHW <= this.#mouse[0]) && (x + cHW * 2 >= this.#mouse[0]); // && (y2Bot >= this.#mouse[1]) && (y2Top <= this.#mouse[1]);

				// Draw value
				if (bright)
					this.ctx.fillStyle = (dp.priceOpen < dp.priceClose) ? this.posStyle : this.negStyle;
				else
					this.ctx.fillStyle = (dp.priceOpen < dp.priceClose) ? this.posStyleDim : this.negStyleDim;

				const sValue = dp.volume * vScale;
				this.ctx.fillRect(x - cHW, this.getH() - sValue, cHW * 2, sValue);

				// Draw candle
				if (bright)
					this.ctx.fillStyle = (dp.priceOpen < dp.priceClose) ? this.posStyleBri : this.negStyleBri;
				else
					this.ctx.fillStyle = (dp.priceOpen < dp.priceClose) ? this.posStyle : this.negStyle;

				this.ctx.fillRect(x - cHW, yBot, cHW * 2, yTop - yBot);
				this.ctx.fillRect(x - 1, y2Bot, 2, y2Top - y2Bot);
			});
		}

		// Draw legend
		const style = window.getComputedStyle(this.node);
		this.ctx.font = style.font;
		const fSize = parseInt(style["font-size"])
		// Draw legend fields
		this.ctx.fillStyle = this.chartBgStyle;
		this.ctx.fillRect(this.getW(), 0, this.#legendRight, this.getH());
		this.ctx.fillRect(0, this.getH(), this.node.width, this.#legendBottom);

		// Draw captions
		this.ctx.fillStyle = "#000";
		this.ctx.textAlign = "center";
		const boxW = this.#legendRight;
		const boxH = this.#legendBottom;
		// X axis
		this.#getGridX().forEach(xG => {
			const x = Math.min(Math.max(this.#ccX(xG), this.#legendRight * .4), this.getW() - this.#legendRight * .4);
			this.ctx.fillText(this.#fmtDate(xG), x, this.getH() + boxH * 2 / 3);
		});
		// Y axix
		this.#getGridY().forEach(yG => {
			const y = Math.min(Math.max(this.#ccY(yG), fSize / 3 + 3), this.getH() - fSize / 3 - 3) + fSize / 3;
			this.ctx.fillText(this.#fmtValue(yG), this.getW() + this.#legendRight / 2, y);
		});

		// Draw current price
		const lastDP = this.#lastPrice;
		let lastY = this.#ccY(lastDP.priceClose);
		if ((lastY >= 0) && (lastY <= this.getH()))
			this.#drawHLineAt(lastDP.priceClose, (lastDP.priceOpen < lastDP.priceClose) ? this.posStyle : this.negStyle);
		
		// Draw cursor captions
		if (!this.#dragging || !this.captureCursor) {
			if ((this.#mouse[1] >= 0) && (this.#mouse[1] <= this.getH())) 
				this.#drawHLineAt(this.#iccY(this.#mouse[1]));
			if ((this.#mouse[0] >= 0) && (this.#mouse[0] <= this.getW()))
				this.#drawVLineAt(this.#iccX(this.#mouse[0]));
		}

		// Draw selection box
		if (this.#box != null) {
			const boxStyle = (this.#box[1] > this.#box[3]) ? this.posStyle : this.negStyle;
			this.ctx.fillStyle = boxStyle;
			this.ctx.globalAlpha = .25;
			const x1 = Math.min(this.#box[0], this.#box[2]);
			const x2 = Math.max(this.#box[0], this.#box[2]);
			const y1 = Math.min(this.#box[1], this.#box[3]);
			const y2 = Math.max(this.#box[1], this.#box[3]);
			this.ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

			this.ctx.globalAlpha = 1;
			const ix1 = this.#iccX(x1);
			const ix2 = this.#iccX(x2);
			const iy1 = this.#iccY(y1);
			const iy2 = this.#iccY(y2);
			this.#drawHLineAt(iy1, "#07f");
			this.#drawHLineAt(iy2, "#07f");
			this.#drawVLineAt(ix1, "#07f");
			this.#drawVLineAt(ix2, "#07f");

			// Draw info box
			// 3 lines of data
			const delta = this.#iccY(this.#box[3]) - this.#iccY(this.#box[1]);
			const percentDelta = delta * 100 / this.#iccY(this.#box[1]);
			const l1 = `${this.#fmtValue(delta)} (${percentDelta.toFixed(2)}%)`;

			let bars = 0;
			let vol = 0;
			this.#data.forEach(dp => { if ((dp.timeOpen >= ix1) && (dp.timeOpen <= ix2)) { ++bars; vol += parseFloat(dp.volume); } });
			if (this.#box[2] < this.#box[0]) bars = -bars;
			let dDiff = this.#getDateDiff(ix1, ix2);
			let l2 = `${bars} bars, `;
			if (dDiff.days > 0) {
				if (dDiff.hours >= 12) ++dDiff.days;
				l2 += `${dDiff.days} d`;
			} else if (dDiff.hours > 0) {
				if (dDiff.minutes >= 30) ++dDiff.hours;
				l2 += `${dDiff.hours} h`;
			} else l2 += `${dDiff.minutes} min`;

			const fmtl = [ 'K', 'M', 'G', 'T' ];
			let vols = vol.toFixed(2);
			for (let e of fmtl) {
				if (vol / 1000 >= 1) {
					vol /= 1000;
					vols = vol.toFixed(3) + e;
				} else break;
			}
			const l3 = `Vol ${vols}`;

			const ibW = Math.max(
					Math.max(this.ctx.measureText(l1).width, this.ctx.measureText(l2).width),
					this.ctx.measureText(l3).width) * 1.2;
			const ibH = this.#legendBottom * 3;

			const ibX = Math.min(Math.max((x1 + x2 - ibW) / 2, 0), this.getW() - ibW);
			const ibY = Math.min(y2 + this.#legendBottom / 4, this.getH() - ibH);

			this.ctx.fillStyle = boxStyle;
			this.ctx.fillRect(ibX, ibY, ibW, ibH);

			this.#legendBottom = parseInt(style["font-size"]) * 2;
			this.ctx.fillStyle = "#fff";
			this.ctx.fillText(l1, ibX + ibW / 2, ibY + fSize * 3 / 2);
			this.ctx.fillText(l2, ibX + ibW / 2, ibY + fSize * 5 / 2);
			this.ctx.fillText(l3, ibX + ibW / 2, ibY + fSize * 7 / 2);

			this.ctx.strokeStyle = boxStyle;
			this.ctx.setLineDash([]);
			this.ctx.beginPath();
			this.ctx.moveTo(x1, (y1 + y2) / 2);
			this.ctx.lineTo(x2, (y1 + y2) / 2);
			this.ctx.moveTo((x1 + x2) / 2, y1);
			this.ctx.lineTo((x1 + x2) / 2, y2);

			if (x2 - x1 >= 10) {
				if (this.#box[0] < this.#box[2]) {
					this.ctx.moveTo(x2 - 10, (y1 + y2) / 2 - 10);
					this.ctx.lineTo(x2, (y1 + y2) / 2);
					this.ctx.lineTo(x2 - 10, (y1 + y2) / 2 + 10);
				} else {
					this.ctx.moveTo(x1 + 10, (y1 + y2) / 2 - 10);
					this.ctx.lineTo(x1, (y1 + y2) / 2);
					this.ctx.lineTo(x1 + 10, (y1 + y2) / 2 + 10);
				}
			}
			if (y2 - y1 >= 10) {
				if (this.#box[1] < this.#box[3]) {
					this.ctx.moveTo((x1 + x2) / 2 + 10, y2 - 10);
					this.ctx.lineTo((x1 + x2) / 2, y2);
					this.ctx.lineTo((x1 + x2) / 2 - 10, y2 - 10);
				} else {
					this.ctx.moveTo((x1 + x2) / 2 + 10, y1 + 10);
					this.ctx.lineTo((x1 + x2) / 2, y1);
					this.ctx.lineTo((x1 + x2) / 2 - 10, y1 + 10);
				}
			}

			this.ctx.stroke();
		}
	}
}
