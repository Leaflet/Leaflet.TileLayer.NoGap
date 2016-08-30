

L.TileLayer.NoGap = L.TileLayer.extend({

	options: {
		/// TODO: This should instead check for the crossOrigin option and enable/disable functionality
		/// accordingly.
		crossOrigin: true
	},

	// Full rewrite of L.GridLayer._updateLevels
	_updateLevels() {
		var zoom = this._tileZoom,
		maxZoom = this.options.maxZoom;

		if (zoom === undefined) { return undefined; }

		for (var z in this._levels) {
			console.log(this._levels[z].el.children.length, (zoom - z));
			if (this._levels[z].el.children.length || (zoom - z) === 0) {
				this._levels[z].el.style.zIndex = maxZoom - Math.abs(zoom - z);
				this._levels[z].canvas.style.zIndex = maxZoom - Math.abs(zoom - z);
			} else {
				L.DomUtil.remove(this._levels[z].el);
				L.DomUtil.remove(this._levels[z].canvas);
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


			level.canvas = L.DomUtil.create('canvas', 'leaflet-tile-container leaflet-zoom-animated', this._container);
			level.ctx = level.canvas.getContext('2d');

			this._resetCanvasSize(level);

			canvasSize = level.canvasPxRange.max.subtract(level.canvasPxRange.min);

			level.canvas.width  = canvasSize.x;
			level.canvas.height = canvasSize.y;
		}

		this._level = level;
		return level;
	},


	_resetCanvasSize: function(level) {
		var buff = this.options.keepBuffer,
			pixelBounds = this._getTiledPixelBounds(map.getCenter()),
			tileRange = this._pxBoundsToTileRange(pixelBounds),
			tileSize = this.getTileSize();

		tileRange.min = tileRange.min.subtract([buff, buff]);	// This adds the no-prune buffer
		tileRange.max = tileRange.max.add([buff+1, buff+1]);

		var pixelRange = L.bounds(
				tileRange.min.scaleBy(tileSize),
				tileRange.max.add([1, 1]).scaleBy(tileSize)	// This prevents an off-by-one when checking if tiles are inside
			),
			mustRepositionCanvas = false;

		// Translate the canvas contents if it's moved around
		if (level.canvasRange) {

			var offset = level.canvasRange.min.subtract(tileRange.min).scaleBy(this.getTileSize());
			var w = level.canvas.width;
			var h = level.canvas.height;

// 			console.log('Repositioning canvas contents by ', offset);

			level.ctx.drawImage(level.canvas, offset.x, offset.y);

			// Top strip
			if (offset.y > 0) level.ctx.clearRect(0, 0, w, offset.y);

			// Bottom strip
			if (offset.y < 0) level.ctx.clearRect(0, h + offset.y, w, -offset.y);

			// Left strip
			if (offset.x > 0) level.ctx.clearRect(0, 0, offset.x, h);

			// Right strip
			if (offset.x < 0) level.ctx.clearRect(w + offset.x, 0, -offset.x, h);

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

		/// TODO: What to do when the canvas size has to change due a map "resize" event or so???
// 		if ()
	},


	/// set transform/position of canvas, in addition to the transform/position of the individual tile container
	_setZoomTransform: function(level, center, zoom) {

		L.TileLayer.prototype._setZoomTransform.call(this, level, center, zoom);
// 		console.log('_setZoomTransform', level, center, zoom);

		if (!level.canvasOrigin) return;	/// FIXME: Move around the _updateLevels code so canvasOrigin exists by the time this is called.

		this._setCanvasZoomTransform(level, center, zoom);
	},


	// This will get called twice:
	// * From _setZoomTransform
	// * When the canvas has shifted due to a pan
	_setCanvasZoomTransform: function(level, center, zoom){
// 		console.log('_setCanvasZoomTransform', level, center, zoom);
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
				} else {
					this._dumpTileToCanvas(tile);	////// !!!!!!
					/// TODO: Do this only if canvas is being used
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

		/// TODO: Check if the tile is inside the currently visible map bounds
		/// There is a possible race condition when tiles are loaded after they
		/// have been panned outside of the map.

		if (!level.canvasRange.contains(tile.coords)) {
			/// Possible improvement: Instead of resetting the canvas size,
			/// calculate the canvas new offset based on
			/// how out the tile is from the canvas range.
			this._resetCanvasSize(level);
		}

		var offset = L.point(tile.coords.x, tile.coords.y).subtract(level.canvasRange.min).scaleBy(this.getTileSize());

// 		console.log('Should dump tile to canvas:', tile);
// 		console.log('Should dump from tile coords:', tile.coords);
// 		console.log('Should dump to canvas px coords:', tile.coords, offset);

		level.ctx.drawImage(tile.el, offset.x, offset.y);

		L.DomUtil.remove(tile.el);

	},



});



/// HACK!!!
/// Make the zoom animations much, much slower by tweaking a hard-coded timeout value
/*
L.Map.include({
	_animateZoom: function (center, zoom, startAnim, noUpdate) {
		if (startAnim) {
			this._animatingZoom = true;

			// remember what center/zoom to set after animation
			this._animateToCenter = center;
			this._animateToZoom = zoom;

			L.DomUtil.addClass(this._mapPane, 'leaflet-zoom-anim');
		}

		// @event zoomanim: ZoomAnimEvent
		// Fired on every frame of a zoom animation
		this.fire('zoomanim', {
			center: center,
			zoom: zoom,
			noUpdate: noUpdate
		});

		// Work around webkit not firing 'transitionend', see https://github.com/Leaflet/Leaflet/issues/3689, 2693
		//// HACK!!!!
// 		setTimeout(L.bind(this._onZoomTransitionEnd, this), 250);
		setTimeout(L.bind(this._onZoomTransitionEnd, this), 5050);
		//// HACK!!!!
	}
});*/


