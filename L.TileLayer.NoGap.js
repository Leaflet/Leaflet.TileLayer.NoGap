

L.TileLayer.NoGap = L.TileLayer.extend({

	options: {
		// @option dumpToCanvas: Boolean = true
		// Whether to dump loaded tiles to a `<canvas>` to prevent some rendering
		// artifacts. (Disabled by default in IE)
		dumpToCanvas: L.Browser.canvas && !L.Browser.ie
	},

	// Full rewrite of L.GridLayer._updateLevels to support dumpToCanvas
	_updateLevels: function() {
		var zoom = this._tileZoom,
		maxZoom = this.options.maxZoom;

		if (zoom === undefined) { return undefined; }

		for (var z in this._levels) {
// 			console.log(this._levels[z].el.children.length, (zoom - z));
			if (this._levels[z].el.children.length || (zoom - z) === 0) {
				this._levels[z].el.style.zIndex = maxZoom - Math.abs(zoom - z);
				if (this.options.dumpToCanvas) {
					this._levels[z].canvas.style.zIndex = maxZoom - Math.abs(zoom - z);
				}
			} else {
				L.DomUtil.remove(this._levels[z].el);
				if (this.options.dumpToCanvas) {
					L.DomUtil.remove(this._levels[z].canvas);
				}
				this._removeTilesAtZoom(z);
				delete this._levels[z];
			}
		}

		var level = this._levels[zoom],
		map = this._map;

		if (!level) {
			level = this._levels[zoom] = {};

			level.el = L.DomUtil.create('div', 'leaflet-tile-container leaflet-zoom-animated', this._container);
			level.el.style.zIndex = maxZoom;

			level.origin = map.project(map.unproject(map.getPixelOrigin()), zoom).round();
			level.zoom = zoom;

			this._setZoomTransform(level, map.getCenter(), map.getZoom());

			// force the browser to consider the newly added element for transition
			L.Util.falseFn(level.el.offsetWidth);

			if (this.options.dumpToCanvas) {
				level.canvas = L.DomUtil.create('canvas', 'leaflet-tile-container leaflet-zoom-animated', this._container);
				level.ctx = level.canvas.getContext('2d');
				this._resetCanvasSize(level);
			}
		}

		this._level = level;
		return level;
	},

	_removeTile: function(key) {
		if (this.options.dumpToCanvas) {
			var tile = this._tiles[key];
			var level = this._levels[tile.coords.z];
			var tileSize = this.getTileSize();

			if (level) {
				// Where in the canvas should this tile go?
				var offset = L.point(tile.coords.x, tile.coords.y).subtract(level.canvasRange.min).scaleBy(this.getTileSize());

				level.ctx.clearRect(offset.x, offset.y, tileSize.x, tileSize.y);
			}
		}

		L.GridLayer.prototype._removeTile.call(this, key);
	},

	_resetCanvasSize: function(level) {
		var buff = this.options.keepBuffer,
			pixelBounds = this._getTiledPixelBounds(this._map.getCenter()),
			tileRange = this._pxBoundsToTileRange(pixelBounds),
			tileSize = this.getTileSize();

		tileRange.min = tileRange.min.subtract([buff, buff]);	// This adds the no-prune buffer
		tileRange.max = tileRange.max.add([buff+1, buff+1]);

		var pixelRange = L.bounds(
				tileRange.min.scaleBy(tileSize),
				tileRange.max.add([1, 1]).scaleBy(tileSize)	// This prevents an off-by-one when checking if tiles are inside
			),
			mustRepositionCanvas = false,
			neededSize = pixelRange.max.subtract(pixelRange.min);

		// Resize the canvas, if needed, and only to make it bigger.
		if (neededSize.x > level.canvas.width || neededSize.y > level.canvas.height) {
			// Resizing canvases erases the currently drawn content, I'm afraid.
			// To keep it, dump the pixels to another canvas, then display it on
			// top. This could be done with getImageData/putImageData, but that
			// would break for tainted canvases (in non-CORS tilesets)
			var oldSize = {x: level.canvas.width, y: level.canvas.height};
// 			console.info('Resizing canvas from ', oldSize, 'to ', neededSize);

			var tmpCanvas = L.DomUtil.create('canvas');
			tmpCanvas.style.width  = (tmpCanvas.width  = oldSize.x) + 'px';
			tmpCanvas.style.height = (tmpCanvas.height = oldSize.y) + 'px';
			tmpCanvas.getContext('2d').drawImage(level.canvas, 0, 0);
// 			var data = level.ctx.getImageData(0, 0, oldSize.x, oldSize.y);

			level.canvas.style.width  = (level.canvas.width  = neededSize.x) + 'px';
			level.canvas.style.height = (level.canvas.height = neededSize.y) + 'px';
			level.ctx.drawImage(tmpCanvas, 0, 0);
// 			level.ctx.putImageData(data, 0, 0, 0, 0, oldSize.x, oldSize.y);
		}

		// Translate the canvas contents if it's moved around
		if (level.canvasRange) {
			var offset = level.canvasRange.min.subtract(tileRange.min).scaleBy(this.getTileSize());

// 			console.info('Offsetting by ', offset);

			if (!L.Browser.safari) {
				// By default, canvases copy things "on top of" existing pixels, but we want
				// this to *replace* the existing pixels when doing a drawImage() call.
				// This will also clear the sides, so no clearRect() calls are needed to make room
				// for the new tiles.
				level.ctx.globalCompositeOperation = 'copy';
				level.ctx.drawImage(level.canvas, offset.x, offset.y);
				level.ctx.globalCompositeOperation = 'source-over';
			} else {
				// Safari clears the canvas when copying from itself :-(
				if (!this._tmpCanvas) {
					var t = this._tmpCanvas = L.DomUtil.create('canvas');
					t.width  = level.canvas.width;
					t.height = level.canvas.height;
					this._tmpContext = t.getContext('2d');
				}
				this._tmpContext.clearRect(0, 0, level.canvas.width, level.canvas.height);
				this._tmpContext.drawImage(level.canvas, 0, 0);
				level.ctx.clearRect(0, 0, level.canvas.width, level.canvas.height);
				level.ctx.drawImage(this._tmpCanvas, offset.x, offset.y);
			}

			mustRepositionCanvas = true;	// Wait until new props are set
		}

		level.canvasRange = tileRange;
		level.canvasPxRange = pixelRange;
		level.canvasOrigin = pixelRange.min;

// 		console.log('Canvas tile range: ', level, tileRange.min, tileRange.max );
// 		console.log('Canvas pixel range: ', pixelRange.min, pixelRange.max );
// 		console.log('Level origin: ', level.origin );

		if (mustRepositionCanvas) {
			this._setCanvasZoomTransform(level, this._map.getCenter(), this._map.getZoom());
		}
	},


	/// set transform/position of canvas, in addition to the transform/position of the individual tile container
	_setZoomTransform: function(level, center, zoom) {
		L.TileLayer.prototype._setZoomTransform.call(this, level, center, zoom);
		if (this.options.dumpToCanvas) {
			this._setCanvasZoomTransform(level, center, zoom);
		}
	},


	// This will get called twice:
	// * From _setZoomTransform
	// * When the canvas has shifted due to a new tile being loaded
	_setCanvasZoomTransform: function(level, center, zoom){
// 		console.log('_setCanvasZoomTransform', level, center, zoom);
		if (!level.canvasOrigin) { return; }
		var scale = this._map.getZoomScale(zoom, level.zoom),
		    translate = level.canvasOrigin.multiplyBy(scale)
		        .subtract(this._map._getNewPixelOrigin(center, zoom)).round();

		if (L.Browser.any3d) {
			L.DomUtil.setTransform(level.canvas, translate, scale);
		} else {
			L.DomUtil.setPosition(level.canvas, translate);
		}
	},


	// Rewrite _updateOpacity to make a func call to dump the faded-in tile into the canvas
	_updateOpacity: function () {
		if (!this._map) { return; }

		// IE doesn't inherit filter opacity properly, so we're forced to set it on tiles
		if (L.Browser.ielt9) { return; }

		L.DomUtil.setOpacity(this._container, this.options.opacity);

		var now = +new Date(),
		    nextFrame = false,
		    willPrune = false;

		for (var key in this._tiles) {
			var tile = this._tiles[key];
			if (!tile.current || !tile.loaded) { continue; }

			var fade = Math.min(1, (now - tile.loaded) / 200);

			L.DomUtil.setOpacity(tile.el, fade);
			if (fade < 1) {
				nextFrame = true;
			} else {
				if (tile.active) {
					willPrune = true;
				} else if (this.options.dumpToCanvas) {
					this._dumpTileToCanvas(tile);
				}
				tile.active = true;
			}
		}

		if (willPrune && !this._noPrune) { this._pruneTiles(); }

		if (nextFrame) {
			L.Util.cancelAnimFrame(this._fadeFrame);
			this._fadeFrame = L.Util.requestAnimFrame(this._updateOpacity, this);
		}
	},

	_dumpTileToCanvas: function(tile){
		var level = this._levels[tile.coords.z];
		var tileSize = this.getTileSize();

		/// Check if the tile is inside the currently visible map bounds
		/// There is a possible race condition when tiles are loaded after they
		/// have been panned outside of the map.
		if (!level.canvasRange.contains(tile.coords)) {
			this._resetCanvasSize(level);
		}

		// Where in the canvas should this tile go?
		var offset = L.point(tile.coords.x, tile.coords.y).subtract(level.canvasRange.min).scaleBy(this.getTileSize());

// 		console.log('Should dump tile to canvas:', tile);
// 		console.log('Dumping:', tile.coords, "at", offset );

		level.ctx.drawImage(tile.el, offset.x, offset.y, tileSize.x, tileSize.y);

		// Do not remove the tile itself, as it is needed to check if the whole
		// level (and its canvas) should be removed (via level.el.children.length)
// 		L.DomUtil.remove(tile.el);
		tile.el.style.display = 'none';


		/// TODO: Clear the pixels of other levels' canvases where they overlap
		/// this newly dumped tile.
	},



});

